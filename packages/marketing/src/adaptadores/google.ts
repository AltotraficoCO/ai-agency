/**
 * Google Ads detrás del puerto de plataformas de anuncios.
 *
 * Traduce en los dos sentidos: de los nombres de Google a los del puerto y al
 * revés. Todo lo que es propio de Google vive aquí para que el agente no sepa
 * que existe —ni GAQL, ni micros, ni cuentas gestoras—.
 *
 * Tres cosas que no son evidentes y que, hechas de otra manera, dan cifras
 * falsas al cliente:
 *
 *  1. **Micros.** Google devuelve el dinero multiplicado por un millón. Un
 *     gasto de 210.000 pesos llega como 210000000000. Se divide aquí; el resto
 *     del sistema nunca ve un micro.
 *  2. **La cuenta gestora.** Una agencia entra con una cuenta MCC que no tiene
 *     campañas propias: lo que hay que listar son sus cuentas hijas, y cada
 *     petición sobre una hija tiene que llevar la gestora en
 *     `login-customer-id` o Google contesta que no existe.
 *  3. **El presupuesto es una entidad aparte.** No se cambia el presupuesto de
 *     una campaña, se cambia el `campaign_budget` al que apunta, que puede ser
 *     COMPARTIDO con otras. Cambiarlo sin mirar significa mover el dinero de
 *     campañas que nadie nombró, así que un presupuesto compartido se rechaza
 *     con un mensaje que explica por qué.
 *
 * Desde el 9 de septiembre de 2026 ya no existe el `developer-token`: el nivel
 * de acceso lo tiene el proyecto de Google Cloud dueño del cliente OAuth, y la
 * API identifica ese proyecto por el access token. La cabecera se ignora hoy y
 * se rechazará en una versión futura, así que no se envía.
 *
 * No se ha probado contra la API real. Los tipos de respuesta siguen la
 * referencia REST de la API y cualquier campo que falte se trata como ausente
 * en vez de romper.
 */
import type {
  AdsPort,
  Campana,
  CambioEstado,
  CambioPresupuesto,
  CuentaPublicitaria,
  EstadoCampana,
  Metricas,
  Periodo,
} from "../ports.js";
import {
  AdsApiError,
  METRICAS_VACIAS,
  numero,
  pedirJson,
  soloCatalogo,
  texto,
  type OpcionesAds,
} from "./http.js";

export type CredencialesGoogleAds = {
  /** De la app de Google Cloud con la API de Google Ads habilitada. */
  readonly clientId: string;
  readonly clientSecret: string;
  /** El que devolvió el consentimiento del cliente. No caduca mientras no lo revoque. */
  readonly refreshToken: string;
  /** Cuenta gestora, si el acceso llegó por una. Solo dígitos. */
  readonly loginCustomerId?: string;
  /** Por si hay que fijar una versión distinta sin tocar el código. */
  readonly version?: string;
};

// Google retira cada versión unos 12 meses después de publicarla: si la API
// contesta 404 en HTML a todo, es que esta versión ya no existe. Y si contesta
// 404 en JSON con «Method not found», es que la versión todavía no se ha
// publicado: el servidor acepta la ruta pero no tiene los métodos. En
// septiembre de 2026 la última publicada era la v25 (22-jul-2026).
const VERSION_POR_DEFECTO = "v25";
const BASE = "https://googleads.googleapis.com";
const URL_TOKEN = "https://oauth2.googleapis.com/token";

/** Un millón: Google guarda el dinero en micros. */
const MICROS = 1_000_000;

/** Tope de campañas que se leen de una cuenta. Pone techo al tiempo y al gasto. */
const TOPE_CAMPANAS = 200;

/** Se renueva el token un minuto antes de que caduque: los relojes no están sincronizados. */
const MARGEN_TOKEN_MS = 60_000;

function estadoDe(valor: unknown): EstadoCampana {
  switch (String(valor ?? "").toUpperCase()) {
    case "ENABLED":
      return "activa";
    case "PAUSED":
      return "pausada";
    case "REMOVED":
      return "finalizada";
    default:
      return "borrador";
  }
}

function estadoHacia(estado: "activa" | "pausada"): string {
  return estado === "activa" ? "ENABLED" : "PAUSED";
}

/** Los identificadores de Google llegan con guiones en la interfaz y sin ellos en la API. */
function soloDigitos(id: string): string {
  return id.replace(/\D/g, "");
}

type FilaBusqueda = {
  campaign?: { id?: unknown; name?: unknown; status?: unknown; campaignBudget?: unknown };
  campaignBudget?: {
    resourceName?: unknown;
    amountMicros?: unknown;
    /** SHARED cuando el presupuesto lo usan varias campañas. */
    explicitlyShared?: unknown;
    referenceCount?: unknown;
  };
  metrics?: {
    costMicros?: unknown;
    impressions?: unknown;
    clicks?: unknown;
    conversions?: unknown;
    conversionsValue?: unknown;
  };
  customerClient?: {
    id?: unknown;
    descriptiveName?: unknown;
    currencyCode?: unknown;
    manager?: unknown;
    status?: unknown;
  };
};

type RespuestaBusqueda = { results?: readonly FilaBusqueda[] };

/** Lo que se guarda de cada campaña además de lo que ve el agente. */
type Interna = {
  readonly presupuestoRecurso: string | null;
  readonly presupuestoCompartido: boolean;
};

export class GoogleAdsAdapter implements AdsPort {
  readonly plataforma = "google_ads" as const;
  readonly puedeEscribir: boolean;

  #token: { valor: string; expira: number } | null = null;
  #cuentas: readonly CuentaPublicitaria[] | null = null;
  /** `cuentaId:campanaId` → lo que hace falta para escribir. */
  readonly #internas = new Map<string, Interna>();

  constructor(
    private readonly creds: CredencialesGoogleAds,
    private readonly o: OpcionesAds = {},
  ) {
    this.puedeEscribir = o.soloLectura !== true;
  }

  get #version(): string {
    return this.creds.version ?? VERSION_POR_DEFECTO;
  }

  /**
   * Un token de acceso válido.
   *
   * Los de Google duran una hora. Se guarda el que haya mientras sirva porque
   * un encargo hace varias llamadas y pedir uno nuevo en cada una multiplica
   * por cinco el tiempo de la revisión.
   */
  async #accessToken(): Promise<string> {
    if (this.#token && this.#token.expira > Date.now() + MARGEN_TOKEN_MS) return this.#token.valor;

    const cuerpo = new URLSearchParams({
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      refresh_token: this.creds.refreshToken,
      grant_type: "refresh_token",
    });
    const datos = (await pedirJson("Google Ads", "renovar el acceso", this.o, URL_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: cuerpo.toString(),
    })) as { access_token?: unknown; expires_in?: unknown } | null;

    const valor = texto(datos?.access_token);
    if (!valor) {
      throw new AdsApiError(
        "Google Ads",
        0,
        "",
        "Google no devolvió un token de acceso. Lo más probable es que el cliente revocara el permiso: hay que volver a conectar la cuenta.",
      );
    }
    this.#token = { valor, expira: Date.now() + numero(datos?.expires_in ?? 3600) * 1000 };
    return valor;
  }

  async #cabeceras(cuentaId?: string): Promise<Record<string, string>> {
    const gestora = this.creds.loginCustomerId ? soloDigitos(this.creds.loginCustomerId) : undefined;
    return {
      Authorization: `Bearer ${await this.#accessToken()}`,
      "content-type": "application/json",
      // Sin esto, una cuenta a la que se llega por la gestora "no existe".
      ...(gestora && gestora !== cuentaId ? { "login-customer-id": gestora } : {}),
    };
  }

  /** Una consulta GAQL contra una cuenta. */
  async #buscar(cuentaId: string, contexto: string, query: string): Promise<readonly FilaBusqueda[]> {
    const datos = (await pedirJson(
      "Google Ads",
      contexto,
      this.o,
      `${BASE}/${this.#version}/customers/${cuentaId}/googleAds:search`,
      {
        method: "POST",
        headers: await this.#cabeceras(cuentaId),
        // Sin `pageSize`: la búsqueda dejó de aceptarlo en la v17 y desde
        // entonces responde INVALID_ARGUMENT. El tope va en el `limit` de GAQL.
        body: JSON.stringify({ query }),
      },
    )) as RespuestaBusqueda | null;
    return datos?.results ?? [];
  }

  async cuentas(): Promise<readonly CuentaPublicitaria[]> {
    if (this.#cuentas) return this.#cuentas;

    const accesibles = (await pedirJson(
      "Google Ads",
      "listar las cuentas",
      this.o,
      `${BASE}/${this.#version}/customers:listAccessibleCustomers`,
      { method: "GET", headers: await this.#cabeceras() },
    )) as { resourceNames?: readonly unknown[] } | null;

    const ids = (accesibles?.resourceNames ?? [])
      .map((r) => soloDigitos(texto(r)))
      .filter((id) => id.length > 0);

    const salida: CuentaPublicitaria[] = [];
    // Si NINGUNA cuenta se deja leer, «no tienes cuentas» sería mentira: lo
    // que hay es un problema de acceso, y el cliente tiene que ver lo que dijo
    // Google para poder arreglarlo (o para poder contárnoslo).
    let primerFallo: AdsApiError | undefined;
    for (const id of ids) {
      // Cada cuenta accesible puede ser una gestora con hijas debajo. Se
      // preguntan las dos cosas de una vez con `customer_client`, que sobre una
      // cuenta suelta se devuelve a sí misma.
      let filas: readonly FilaBusqueda[];
      try {
        filas = await this.#buscar(
          id,
          "leer los datos de la cuenta",
          `select customer_client.id, customer_client.descriptive_name,
                  customer_client.currency_code, customer_client.manager,
                  customer_client.status
             from customer_client
            where customer_client.status = 'ENABLED'`,
        );
      } catch (error) {
        // Una cuenta cancelada o sin permiso no puede tumbar la lista entera:
        // el cliente tiene las demás y el agente debe poder trabajar con ellas.
        if (error instanceof AdsApiError) {
          primerFallo ??= error;
          continue;
        }
        throw error;
      }

      for (const fila of filas) {
        const hija = fila.customerClient;
        const hijaId = soloDigitos(texto(hija?.id));
        // Las gestoras no tienen campañas: listarlas solo confunde a quien elige.
        if (!hijaId || hija?.manager === true) continue;
        if (salida.some((c) => c.id === hijaId)) continue;
        salida.push({
          id: hijaId,
          plataforma: this.plataforma,
          nombre: texto(hija?.descriptiveName, `Cuenta ${hijaId}`),
          moneda: texto(hija?.currencyCode, "USD").toUpperCase(),
        });
      }
    }

    if (salida.length === 0 && primerFallo) throw primerFallo;

    this.#cuentas = salida;
    return salida;
  }

  async campanas(input: { cuentaId: string; periodo: Periodo }): Promise<readonly Campana[]> {
    const cuentaId = soloDigitos(input.cuentaId);
    const catalogo = soloCatalogo(input.periodo);

    // Sin métricas cuando solo se quiere saber cómo se llama y qué tiene puesto:
    // Google rechaza un rango de 1970 y la consulta entera se caería.
    const query = catalogo
      ? `select campaign.id, campaign.name, campaign.status, campaign.campaign_budget,
                campaign_budget.resource_name, campaign_budget.amount_micros,
                campaign_budget.explicitly_shared, campaign_budget.reference_count
           from campaign
          where campaign.status != 'REMOVED'
          limit ${TOPE_CAMPANAS}`
      : `select campaign.id, campaign.name, campaign.status, campaign.campaign_budget,
                campaign_budget.resource_name, campaign_budget.amount_micros,
                campaign_budget.explicitly_shared, campaign_budget.reference_count,
                metrics.cost_micros, metrics.impressions, metrics.clicks,
                metrics.conversions, metrics.conversions_value
           from campaign
          where campaign.status != 'REMOVED'
            and segments.date between '${input.periodo.desde}' and '${input.periodo.hasta}'
          limit ${TOPE_CAMPANAS}`;

    const filas = await this.#buscar(cuentaId, "leer las campañas", query);

    // Con métricas, Google devuelve una fila por campaña ya agregada en el
    // rango; sin métricas, una por campaña. En ambos casos se indexa por id
    // para no depender de eso.
    const porId = new Map<string, Campana>();
    for (const fila of filas) {
      const id = texto(fila.campaign?.id);
      if (!id) continue;

      const presupuestoMicros = fila.campaignBudget?.amountMicros;
      const compartido =
        fila.campaignBudget?.explicitlyShared === true || numero(fila.campaignBudget?.referenceCount) > 1;
      this.#internas.set(`${cuentaId}:${id}`, {
        presupuestoRecurso:
          texto(fila.campaignBudget?.resourceName) || texto(fila.campaign?.campaignBudget) || null,
        presupuestoCompartido: compartido,
      });

      const metricas: Metricas = fila.metrics
        ? {
            gasto: numero(fila.metrics.costMicros) / MICROS,
            impresiones: numero(fila.metrics.impressions),
            clics: numero(fila.metrics.clicks),
            conversiones: numero(fila.metrics.conversions),
            ...(fila.metrics.conversionsValue === undefined
              ? {}
              : { valorConversiones: numero(fila.metrics.conversionsValue) }),
          }
        : { ...METRICAS_VACIAS };

      porId.set(id, {
        id,
        nombre: texto(fila.campaign?.name, `Campaña ${id}`),
        estado: estadoDe(fila.campaign?.status),
        ...(presupuestoMicros === undefined
          ? {}
          : { presupuestoDiario: numero(presupuestoMicros) / MICROS }),
        metricas,
      });
    }
    return [...porId.values()];
  }

  async cambiarPresupuesto(input: {
    cuentaId: string;
    campanaId: string;
    diario: number;
  }): Promise<CambioPresupuesto> {
    this.#exigirEscritura();
    const cuentaId = soloDigitos(input.cuentaId);
    const campanas = await this.campanas({
      cuentaId,
      periodo: { desde: "1970-01-01", hasta: "1970-01-01" },
    });
    const campana = campanas.find((c) => c.id === input.campanaId);
    const interna = this.#internas.get(`${cuentaId}:${input.campanaId}`);
    if (!campana || !interna?.presupuestoRecurso) {
      throw new AdsApiError(
        "Google Ads",
        0,
        "",
        `No encuentro el presupuesto de la campaña ${input.campanaId} en la cuenta ${cuentaId}.`,
      );
    }
    if (interna.presupuestoCompartido) {
      throw new AdsApiError(
        "Google Ads",
        0,
        "",
        `El presupuesto de «${campana.nombre}» está compartido con otras campañas: cambiarlo movería también el dinero de campañas que nadie nombró. Hay que separarlo primero en Google Ads.`,
      );
    }

    await pedirJson(
      "Google Ads",
      "cambiar el presupuesto",
      this.o,
      `${BASE}/${this.#version}/customers/${cuentaId}/campaignBudgets:mutate`,
      {
        method: "POST",
        headers: await this.#cabeceras(cuentaId),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resourceName: interna.presupuestoRecurso,
                amountMicros: Math.round(input.diario * MICROS),
              },
              updateMask: "amount_micros",
            },
          ],
        }),
      },
    );

    return {
      campanaId: input.campanaId,
      anterior: campana.presupuestoDiario ?? 0,
      nuevo: input.diario,
    };
  }

  async cambiarEstado(input: {
    cuentaId: string;
    campanaId: string;
    estado: "activa" | "pausada";
  }): Promise<CambioEstado> {
    this.#exigirEscritura();
    const cuentaId = soloDigitos(input.cuentaId);
    const campanas = await this.campanas({
      cuentaId,
      periodo: { desde: "1970-01-01", hasta: "1970-01-01" },
    });
    const campana = campanas.find((c) => c.id === input.campanaId);
    if (!campana) {
      throw new AdsApiError("Google Ads", 0, "", `No encuentro la campaña ${input.campanaId} en esa cuenta.`);
    }

    await pedirJson(
      "Google Ads",
      input.estado === "pausada" ? "pausar la campaña" : "reactivar la campaña",
      this.o,
      `${BASE}/${this.#version}/customers/${cuentaId}/campaigns:mutate`,
      {
        method: "POST",
        headers: await this.#cabeceras(cuentaId),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resourceName: `customers/${cuentaId}/campaigns/${input.campanaId}`,
                status: estadoHacia(input.estado),
              },
              updateMask: "status",
            },
          ],
        }),
      },
    );

    return { campanaId: input.campanaId, anterior: campana.estado, nuevo: input.estado };
  }

  #exigirEscritura(): void {
    if (this.puedeEscribir) return;
    throw new AdsApiError(
      "Google Ads",
      0,
      "",
      "La conexión con Google Ads es de solo lectura: se puede proponer el cambio, pero no aplicarlo.",
    );
  }
}

export function crearAdsGoogle(creds: CredencialesGoogleAds, o: OpcionesAds = {}): AdsPort {
  return new GoogleAdsAdapter(creds, o);
}
