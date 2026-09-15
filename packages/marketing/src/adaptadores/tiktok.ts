/**
 * TikTok Ads (Business API) detrás del puerto de anuncios.
 *
 * Lo propio de TikTok que el agente no tiene por qué saber:
 *
 *  1. **Un error suyo llega con un 200.** TikTok contesta `HTTP 200` con
 *     `{"code": 40002, "message": "..."}` cuando algo falla. Tratar el 200 como
 *     éxito —que es lo que hace cualquier cliente HTTP— convertiría un token
 *     caducado en «la cuenta no tiene campañas», y el agente le diría al cliente
 *     que no está gastando nada. Todas las respuestas pasan por `#datos`, que
 *     mira el `code` antes que nada.
 *  2. **El presupuesto va en la moneda de la cuenta, no en centavos.** Al revés
 *     que Meta. 50.000 pesos son 50000.
 *  3. **Las cifras viven en otro sitio.** La lista de campañas no trae gasto:
 *     eso es el informe (`/report/integrated/get/`), con sus propios nombres de
 *     métricas. Se piden las dos cosas y se cruzan por `campaign_id`.
 *  4. **Presupuesto diario o total.** Una campaña con `BUDGET_MODE_TOTAL` tiene
 *     presupuesto para toda su vida, no por día: darlo por diario multiplicaría
 *     por treinta lo que el cliente cree que gasta, así que se deja sin
 *     presupuesto diario y se dice al intentar cambiarlo.
 *
 * No se ha probado contra la API real: la app de TikTok for Business está
 * pendiente de aprobación.
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

export type CredencialesTiktokAds = {
  /** El token del cliente. Los de TikTok no caducan mientras no se revoquen. */
  readonly accessToken: string;
  /** De NUESTRA app en TikTok for Business: hacen falta para listar anunciantes. */
  readonly appId: string;
  readonly secret: string;
  readonly version?: string;
};

const VERSION_POR_DEFECTO = "v1.3";
const BASE = "https://business-api.tiktok.com/open_api";

const TOPE_CAMPANAS = 200;

/** Presupuesto por día. Los otros modos (total, ilimitado) no son diarios. */
const MODO_DIARIO = "BUDGET_MODE_DAY";

function estadoDe(operacion: unknown, secundario: unknown): EstadoCampana {
  const sec = String(secundario ?? "").toUpperCase();
  if (sec.includes("DELETE")) return "finalizada";
  // CAMPAIGN_STATUS_ADVERTISER_AUDIT, ..._NOT_START: aún no ha corrido nada.
  if (sec.includes("AUDIT") || sec.includes("NOT_START")) return "borrador";
  return String(operacion ?? "").toUpperCase() === "ENABLE" ? "activa" : "pausada";
}

type FilaCampana = {
  campaign_id?: unknown;
  campaign_name?: unknown;
  operation_status?: unknown;
  secondary_status?: unknown;
  budget?: unknown;
  budget_mode?: unknown;
};

type FilaInforme = {
  dimensions?: { campaign_id?: unknown };
  metrics?: {
    spend?: unknown;
    impressions?: unknown;
    clicks?: unknown;
    conversion?: unknown;
    total_purchase_value?: unknown;
  };
};

export class TiktokAdsAdapter implements AdsPort {
  readonly plataforma = "tiktok_ads" as const;
  readonly puedeEscribir: boolean;

  #cuentas: readonly CuentaPublicitaria[] | null = null;
  /** `cuentaId:campanaId` → modo de presupuesto, que hace falta para escribir. */
  readonly #modos = new Map<string, string>();

  constructor(
    private readonly creds: CredencialesTiktokAds,
    private readonly o: OpcionesAds = {},
  ) {
    this.puedeEscribir = o.soloLectura !== true;
  }

  get #version(): string {
    return this.creds.version ?? VERSION_POR_DEFECTO;
  }

  #url(ruta: string, parametros: Record<string, string> = {}): string {
    const url = new URL(`${BASE}/${this.#version}/${ruta}`);
    for (const [clave, valor] of Object.entries(parametros)) url.searchParams.set(clave, valor);
    return url.toString();
  }

  /**
   * El `data` de una respuesta, después de comprobar el `code`.
   *
   * Es el único sitio por el que pasan las respuestas de TikTok, justamente
   * porque un error suyo viene con un 200 y sin esto pasaría por bueno.
   */
  async #datos(contexto: string, url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const cuerpo = (await pedirJson("TikTok", contexto, this.o, url, {
      ...init,
      headers: { "Access-Token": this.creds.accessToken, "content-type": "application/json" },
    })) as { code?: unknown; message?: unknown; data?: unknown } | null;

    const code = numero(cuerpo?.code);
    if (code !== 0) {
      const mensaje = texto(cuerpo?.message, "sin detalle");
      throw new AdsApiError(
        "TikTok",
        code,
        mensaje,
        code === 40001 || code === 40100 || code === 40105
          ? `TikTok ya no acepta la conexión (${mensaje}). Lo normal es que el cliente revocara el permiso: hay que volver a conectar la cuenta.`
          : `TikTok rechazó ${contexto} (${code}): ${mensaje}`,
      );
    }
    const datos = cuerpo?.data;
    return typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  }

  async #lista<T>(contexto: string, url: string): Promise<readonly T[]> {
    const datos = await this.#datos(contexto, url, { method: "GET" });
    const lista = datos["list"];
    return Array.isArray(lista) ? (lista as readonly T[]) : [];
  }

  async cuentas(): Promise<readonly CuentaPublicitaria[]> {
    if (this.#cuentas) return this.#cuentas;

    type Anunciante = { advertiser_id?: unknown; advertiser_name?: unknown };
    const anunciantes = await this.#lista<Anunciante>(
      "listar las cuentas",
      this.#url("oauth2/advertiser/get/", { app_id: this.creds.appId, secret: this.creds.secret }),
    );
    const ids = anunciantes.map((a) => texto(a.advertiser_id)).filter((id) => id.length > 0);
    if (ids.length === 0) {
      this.#cuentas = [];
      return this.#cuentas;
    }

    // El nombre viene en el listado, pero la MONEDA solo en la ficha: sin ella
    // habría que adivinar en qué se están escribiendo las cifras.
    type Ficha = { advertiser_id?: unknown; name?: unknown; currency?: unknown; status?: unknown };
    const fichas = await this.#lista<Ficha>(
      "leer los datos de las cuentas",
      this.#url("advertiser/info/", {
        advertiser_ids: JSON.stringify(ids),
        fields: JSON.stringify(["advertiser_id", "name", "currency", "status"]),
      }),
    );

    const porId = new Map(fichas.map((f) => [texto(f.advertiser_id), f]));
    this.#cuentas = ids.map((id) => {
      const ficha = porId.get(id);
      const nombre = texto(ficha?.name) || texto(anunciantes.find((a) => texto(a.advertiser_id) === id)?.advertiser_name, `Cuenta ${id}`);
      return {
        id,
        plataforma: this.plataforma,
        nombre,
        moneda: texto(ficha?.currency, "USD").toUpperCase(),
      };
    });
    return this.#cuentas;
  }

  async campanas(input: { cuentaId: string; periodo: Periodo }): Promise<readonly Campana[]> {
    const campanas = await this.#lista<FilaCampana>(
      "leer las campañas",
      this.#url("campaign/get/", {
        advertiser_id: input.cuentaId,
        page_size: String(TOPE_CAMPANAS),
      }),
    );

    const cifras = new Map<string, FilaInforme>();
    if (!soloCatalogo(input.periodo)) {
      const filas = await this.#lista<FilaInforme>(
        "leer las cifras de las campañas",
        this.#url("report/integrated/get/", {
          advertiser_id: input.cuentaId,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: JSON.stringify(["campaign_id"]),
          metrics: JSON.stringify([
            "spend",
            "impressions",
            "clicks",
            "conversion",
            "total_purchase_value",
          ]),
          start_date: input.periodo.desde,
          end_date: input.periodo.hasta,
          page_size: String(TOPE_CAMPANAS),
        }),
      );
      for (const fila of filas) {
        const id = texto(fila.dimensions?.campaign_id);
        if (id) cifras.set(id, fila);
      }
    }

    return campanas
      .map((c): Campana | null => {
        const id = texto(c.campaign_id);
        if (!id) return null;
        const modo = texto(c.budget_mode);
        this.#modos.set(`${input.cuentaId}:${id}`, modo);

        const m = cifras.get(id)?.metrics;
        const metricas: Metricas = m
          ? {
              gasto: numero(m.spend),
              impresiones: numero(m.impressions),
              clics: numero(m.clicks),
              conversiones: numero(m.conversion),
              ...(m.total_purchase_value === undefined
                ? {}
                : { valorConversiones: numero(m.total_purchase_value) }),
            }
          : { ...METRICAS_VACIAS };

        return {
          id,
          nombre: texto(c.campaign_name, `Campaña ${id}`),
          estado: estadoDe(c.operation_status, c.secondary_status),
          // Solo el diario es diario: un presupuesto total dado por diario
          // multiplicaría por treinta lo que el cliente cree que gasta.
          ...(modo === MODO_DIARIO && c.budget !== undefined
            ? { presupuestoDiario: numero(c.budget) }
            : {}),
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
    const campana = await this.#campana(input.cuentaId, input.campanaId);
    const modo = this.#modos.get(`${input.cuentaId}:${input.campanaId}`);

    if (modo !== MODO_DIARIO) {
      throw new AdsApiError(
        "TikTok",
        0,
        "",
        `«${campana.nombre}» no tiene presupuesto por día${
          modo === "BUDGET_MODE_TOTAL" ? " sino para toda la campaña" : ""
        }: para poder ajustarlo desde aquí hay que ponerle presupuesto diario en TikTok.`,
      );
    }

    await this.#datos("cambiar el presupuesto", this.#url("campaign/update/"), {
      method: "POST",
      body: JSON.stringify({
        advertiser_id: input.cuentaId,
        campaign_id: input.campanaId,
        budget: input.diario,
        budget_mode: MODO_DIARIO,
      }),
    });

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
    const campana = await this.#campana(input.cuentaId, input.campanaId);

    await this.#datos(
      input.estado === "pausada" ? "pausar la campaña" : "reactivar la campaña",
      this.#url("campaign/status/update/"),
      {
        method: "POST",
        body: JSON.stringify({
          advertiser_id: input.cuentaId,
          campaign_ids: [input.campanaId],
          operation_status: input.estado === "activa" ? "ENABLE" : "DISABLE",
        }),
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
      throw new AdsApiError("TikTok", 0, "", `No encuentro la campaña ${campanaId} en esa cuenta.`);
    }
    return campana;
  }

  #exigirEscritura(): void {
    if (this.puedeEscribir) return;
    throw new AdsApiError(
      "TikTok",
      0,
      "",
      "La conexión con TikTok es de solo lectura: se puede proponer el cambio, pero no aplicarlo.",
    );
  }
}

export function crearAdsTiktok(creds: CredencialesTiktokAds, o: OpcionesAds = {}): AdsPort {
  return new TiktokAdsAdapter(creds, o);
}
