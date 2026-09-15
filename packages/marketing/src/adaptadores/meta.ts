/**
 * Facebook e Instagram (Meta Marketing API) detrás del puerto de anuncios.
 *
 * Lo propio de Meta que el agente no tiene por qué saber:
 *
 *  1. **El dinero va en la unidad mínima de la moneda.** Un presupuesto de
 *     50.000 pesos llega como «50000» y uno de 50 dólares como «5000». Sin la
 *     tabla de monedas sin decimales (`decimalesDe`), a un cliente colombiano
 *     se le diría que gasta 500 pesos al día.
 *  2. **El presupuesto puede no estar en la campaña.** Meta lo pone en la
 *     campaña solo cuando el cliente activó el presupuesto de campaña
 *     (Advantage/CBO); si no, vive en cada conjunto de anuncios. Se dice con
 *     esas palabras en vez de fallar con «param daily_budget is invalid».
 *  3. **Las cifras y las campañas vienen por separado.** La lista de campañas
 *     no trae gasto: eso es `insights`, otra llamada con su propio rango. Se
 *     piden las dos y se cruzan por `campaign_id`.
 *  4. **Qué cuenta como «resultado».** Meta no devuelve un número de
 *     resultados: devuelve una lista de acciones de todo tipo, desde una
 *     reproducción de vídeo hasta una compra. Contarlas todas daría cifras
 *     absurdas, así que se cuenta la acción que corresponde al objetivo de la
 *     campaña —que es lo que el propio Ads Manager enseña como resultado— y,
 *     si no hay forma de saberlo, la primera acción de la lista de intención
 *     de compra. Nunca se suman entre sí.
 *
 * No se ha probado contra la API real: la app de Meta está pendiente de los
 * permisos `ads_read` y `ads_management`.
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
  aUnidadMinima,
  desdeUnidadMinima,
  METRICAS_VACIAS,
  numero,
  pedirJson,
  soloCatalogo,
  texto,
  type OpcionesAds,
} from "./http.js";

export type CredencialesMetaAds = {
  /** Token del usuario que dio el permiso, ya de larga duración (60 días). */
  readonly accessToken: string;
  /** Para poder avisar cuándo caduca sin tener que preguntárselo a Meta. */
  readonly expiraEn?: string;
  readonly version?: string;
};

const VERSION_POR_DEFECTO = "v21.0";
const BASE = "https://graph.facebook.com";

const TOPE_CAMPANAS = 200;
const TOPE_PAGINAS = 5;

function estadoDe(valor: unknown): EstadoCampana {
  switch (String(valor ?? "").toUpperCase()) {
    case "ACTIVE":
      return "activa";
    case "PAUSED":
      return "pausada";
    case "DELETED":
    case "ARCHIVED":
      return "finalizada";
    default:
      return "borrador";
  }
}

/**
 * Qué acción es «el resultado» según el objetivo de la campaña.
 *
 * Es el mismo criterio que usa Ads Manager en su columna «Resultados»: una
 * campaña de mensajes cuenta conversaciones iniciadas, una de ventas cuenta
 * compras. Los objetivos llegan con el nombre nuevo (OUTCOME_*) o con el
 * antiguo según la antigüedad de la campaña, así que están los dos.
 */
const ACCION_POR_OBJETIVO: Readonly<Record<string, readonly string[]>> = {
  OUTCOME_SALES: ["purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"],
  CONVERSIONS: ["purchase", "offsite_conversion.fb_pixel_purchase"],
  OUTCOME_LEADS: ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"],
  LEAD_GENERATION: ["lead", "offsite_conversion.fb_pixel_lead"],
  OUTCOME_ENGAGEMENT: [
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.total_messaging_connection",
    "post_engagement",
  ],
  MESSAGES: ["onsite_conversion.messaging_conversation_started_7d"],
  OUTCOME_TRAFFIC: ["landing_page_view", "link_click"],
  LINK_CLICKS: ["link_click"],
  OUTCOME_APP_PROMOTION: ["app_install", "mobile_app_install"],
  APP_INSTALLS: ["mobile_app_install"],
};

/** Cuando no se sabe el objetivo: lo más parecido a un cliente, en orden. */
const ACCIONES_POR_DEFECTO: readonly string[] = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "lead",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.messaging_conversation_started_7d",
  "complete_registration",
  "landing_page_view",
];

type Accion = { action_type?: unknown; value?: unknown };

/** El valor de la PRIMERA acción de la lista que exista. Nunca se suman. */
function primeraAccion(acciones: readonly Accion[], candidatas: readonly string[]): number | null {
  for (const tipo of candidatas) {
    const encontrada = acciones.find((a) => texto(a.action_type) === tipo);
    if (encontrada) return numero(encontrada.value);
  }
  return null;
}

function resultadosDe(fila: FilaInsights, objetivo: string): { conversiones: number; valor?: number } {
  const acciones = (fila.actions ?? []) as readonly Accion[];
  const valores = (fila.action_values ?? []) as readonly Accion[];
  const candidatas = ACCION_POR_OBJETIVO[objetivo.toUpperCase()] ?? ACCIONES_POR_DEFECTO;

  const conversiones = primeraAccion(acciones, candidatas) ?? primeraAccion(acciones, ACCIONES_POR_DEFECTO) ?? 0;
  const valor = primeraAccion(valores, candidatas) ?? undefined;
  return { conversiones, ...(valor === undefined ? {} : { valor }) };
}

type FilaCampana = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  effective_status?: unknown;
  objective?: unknown;
  daily_budget?: unknown;
  lifetime_budget?: unknown;
};

type FilaInsights = {
  campaign_id?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  actions?: readonly unknown[];
  action_values?: readonly unknown[];
};

type Pagina<T> = { data?: readonly T[]; paging?: { next?: unknown } };

export class MetaAdsAdapter implements AdsPort {
  readonly plataforma = "meta_ads" as const;
  readonly puedeEscribir: boolean;

  #cuentas: readonly CuentaPublicitaria[] | null = null;

  constructor(
    private readonly creds: CredencialesMetaAds,
    private readonly o: OpcionesAds = {},
  ) {
    this.puedeEscribir = o.soloLectura !== true;
  }

  get #version(): string {
    return this.creds.version ?? VERSION_POR_DEFECTO;
  }

  #cabeceras(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.accessToken}`,
      "content-type": "application/json",
    };
  }

  /** Sigue el `paging.next` de Meta hasta agotarlo o hasta el tope. */
  async #paginar<T>(contexto: string, primera: string): Promise<readonly T[]> {
    const salida: T[] = [];
    let url: string | null = primera;
    for (let i = 0; i < TOPE_PAGINAS && url; i++) {
      const pagina = (await pedirJson("Meta", contexto, this.o, url, {
        method: "GET",
        headers: this.#cabeceras(),
      })) as Pagina<T> | null;
      salida.push(...(pagina?.data ?? []));
      const siguiente = texto(pagina?.paging?.next);
      url = siguiente || null;
    }
    return salida;
  }

  /** `act_123` tanto si llega con prefijo como si llega solo el número. */
  #act(cuentaId: string): string {
    return cuentaId.startsWith("act_") ? cuentaId : `act_${cuentaId.replace(/\D/g, "")}`;
  }

  async cuentas(): Promise<readonly CuentaPublicitaria[]> {
    if (this.#cuentas) return this.#cuentas;

    type Fila = { id?: unknown; name?: unknown; currency?: unknown; account_status?: unknown };
    const filas = await this.#paginar<Fila>(
      "listar las cuentas",
      `${BASE}/${this.#version}/me/adaccounts?fields=id,name,currency,account_status&limit=100`,
    );

    this.#cuentas = filas
      // 1 es activa; 2 deshabilitada, 3 sin método de pago, 101 cerrada. Una
      // cuenta cerrada en la lista solo sirve para que el agente la elija y
      // fracase después.
      .filter((f) => numero(f.account_status) === 1)
      .map((f) => {
        const id = texto(f.id);
        return {
          id,
          plataforma: this.plataforma,
          nombre: texto(f.name, id),
          moneda: texto(f.currency, "USD").toUpperCase(),
        };
      })
      .filter((c) => c.id.length > 0);
    return this.#cuentas;
  }

  async #monedaDe(cuentaId: string): Promise<string> {
    const cuenta = (await this.cuentas()).find((c) => c.id === this.#act(cuentaId) || c.id === cuentaId);
    return cuenta?.moneda ?? "USD";
  }

  async campanas(input: { cuentaId: string; periodo: Periodo }): Promise<readonly Campana[]> {
    const act = this.#act(input.cuentaId);
    const moneda = await this.#monedaDe(input.cuentaId);

    const campanas = await this.#paginar<FilaCampana>(
      "leer las campañas",
      `${BASE}/${this.#version}/${act}/campaigns` +
        `?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget` +
        `&limit=${TOPE_CAMPANAS}`,
    );

    // Las cifras son otra llamada. Cuando solo hace falta el catálogo (cambiar
    // un presupuesto, pausar), se la ahorra entera.
    const cifras = new Map<string, FilaInsights>();
    if (!soloCatalogo(input.periodo)) {
      const rango = encodeURIComponent(
        JSON.stringify({ since: input.periodo.desde, until: input.periodo.hasta }),
      );
      const filas = await this.#paginar<FilaInsights>(
        "leer las cifras de las campañas",
        `${BASE}/${this.#version}/${act}/insights` +
          `?level=campaign&time_range=${rango}&time_increment=all_days` +
          `&fields=campaign_id,spend,impressions,clicks,actions,action_values` +
          `&limit=${TOPE_CAMPANAS}`,
      );
      for (const fila of filas) {
        const id = texto(fila.campaign_id);
        if (id) cifras.set(id, fila);
      }
    }

    return campanas
      .map((c): Campana | null => {
        const id = texto(c.id);
        if (!id) return null;
        const fila = cifras.get(id);
        const objetivo = texto(c.objective);

        let metricas: Metricas = { ...METRICAS_VACIAS };
        if (fila) {
          const { conversiones, valor } = resultadosDe(fila, objetivo);
          metricas = {
            // `spend` ya viene en la moneda de la cuenta, no en centavos.
            gasto: numero(fila.spend),
            impresiones: numero(fila.impressions),
            clics: numero(fila.clicks),
            conversiones,
            ...(valor === undefined ? {} : { valorConversiones: valor }),
          };
        }

        return {
          id,
          nombre: texto(c.name, `Campaña ${id}`),
          // `effective_status` dice si está parada por la cuenta o por límite de
          // gasto; `status` solo dice lo que pidió el cliente.
          estado: estadoDe(c.effective_status ?? c.status),
          ...(c.daily_budget === undefined || c.daily_budget === null
            ? {}
            : { presupuestoDiario: desdeUnidadMinima(c.daily_budget, moneda) }),
          metricas,
        };
      })
      .filter((c): c is Campana => c !== null);
  }

  async cambiarPresupuesto(input: {
    cuentaId: string;
    campanaId: string;
    diario: number;
  }): Promise<CambioPresupuesto> {
    this.#exigirEscritura();
    const moneda = await this.#monedaDe(input.cuentaId);
    const campana = await this.#campana(input.cuentaId, input.campanaId);

    if (campana.presupuestoDiario === undefined) {
      throw new AdsApiError(
        "Meta",
        0,
        "",
        `«${campana.nombre}» no lleva el presupuesto en la campaña sino en cada conjunto de anuncios. Para poder cambiarlo desde aquí hay que activarle el presupuesto de campaña (Advantage) en el administrador de anuncios.`,
      );
    }

    await pedirJson(
      "Meta",
      "cambiar el presupuesto",
      this.o,
      `${BASE}/${this.#version}/${input.campanaId}`,
      {
        method: "POST",
        headers: this.#cabeceras(),
        body: JSON.stringify({ daily_budget: String(aUnidadMinima(input.diario, moneda)) }),
      },
    );

    return { campanaId: input.campanaId, anterior: campana.presupuestoDiario, nuevo: input.diario };
  }

  async cambiarEstado(input: {
    cuentaId: string;
    campanaId: string;
    estado: "activa" | "pausada";
  }): Promise<CambioEstado> {
    this.#exigirEscritura();
    const campana = await this.#campana(input.cuentaId, input.campanaId);

    await pedirJson(
      "Meta",
      input.estado === "pausada" ? "pausar la campaña" : "reactivar la campaña",
      this.o,
      `${BASE}/${this.#version}/${input.campanaId}`,
      {
        method: "POST",
        headers: this.#cabeceras(),
        body: JSON.stringify({ status: input.estado === "activa" ? "ACTIVE" : "PAUSED" }),
      },
    );

    return { campanaId: input.campanaId, anterior: campana.estado, nuevo: input.estado };
  }

  async #campana(cuentaId: string, campanaId: string): Promise<Campana> {
    const campanas = await this.campanas({
      cuentaId,
      periodo: { desde: "1970-01-01", hasta: "1970-01-01" },
    });
    const campana = campanas.find((c) => c.id === campanaId);
    if (!campana) {
      throw new AdsApiError("Meta", 0, "", `No encuentro la campaña ${campanaId} en esa cuenta.`);
    }
    return campana;
  }

  #exigirEscritura(): void {
    if (this.puedeEscribir) return;
    throw new AdsApiError(
      "Meta",
      0,
      "",
      "La conexión con Facebook e Instagram es de solo lectura: se puede proponer el cambio, pero no aplicarlo.",
    );
  }
}

export function crearAdsMeta(creds: CredencialesMetaAds, o: OpcionesAds = {}): AdsPort {
  return new MetaAdsAdapter(creds, o);
}
