/**
 * Puertos del agente de Marketing.
 *
 * Aquí no hay ni una llamada HTTP: son las interfaces que el worker rellena
 * con adaptadores reales (Google Ads, Meta, TikTok, Analytics) y que los tests
 * rellenan con dobles. Esa frontera es lo que permite construir y probar el
 * agente ENTERO hoy, aunque los accesos de las plataformas tarden semanas en
 * aprobarse.
 *
 * Las cifras viajan ya normalizadas —misma forma para Google, para Meta y para TikTok— por
 * una razón de producto: al cliente se le habla de «lo que te cuesta cada
 * cliente nuevo», no de los nombres que cada plataforma le da a sus métricas.
 * Traducir es trabajo del adaptador, no del modelo.
 *
 * Los puertos de aprobación y backup se declaran aquí con la misma forma que
 * los del Webmaster a propósito: TypeScript es estructural, así que los
 * adaptadores que el worker ya tiene encajan sin cambios y sin que este
 * paquete dependa de aquel.
 */

/**
 * Las plataformas que el agente sabe mirar.
 *
 * La lista se declara UNA vez y de ella salen el tipo y los `z.enum` de las
 * herramientas: cuando se añadió TikTok, el enum de `tools/lectura.ts` y el de
 * `tools/cambios.ts` eran dos listas escritas a mano que había que acordarse de
 * tocar, y olvidar una significa una herramienta que rechaza una plataforma que
 * el resto del sistema da por conectada.
 */
export const PLATAFORMAS = ["google_ads", "meta_ads", "tiktok_ads"] as const;

export type Plataforma = (typeof PLATAFORMAS)[number];

/** Lo que hay que llamar por su nombre en la interfaz del cliente. */
export const NOMBRE_PLATAFORMA: Readonly<Record<Plataforma, string>> = {
  google_ads: "Google Ads",
  meta_ads: "Facebook e Instagram",
  tiktok_ads: "TikTok",
};

export type CuentaPublicitaria = {
  readonly id: string;
  readonly plataforma: Plataforma;
  readonly nombre: string;
  /** ISO 4217: COP, USD, MXN… Se usa para escribir las cifras como las lee el cliente. */
  readonly moneda: string;
};

/** Rango cerrado, en fechas locales de la cuenta (YYYY-MM-DD). */
export type Periodo = {
  readonly desde: string;
  readonly hasta: string;
};

/**
 * Métricas de un periodo, ya en la moneda de la cuenta.
 *
 * `conversiones` es «resultados»: formularios, mensajes de WhatsApp, compras…
 * lo que el cliente haya configurado como objetivo. El agente nunca decide qué
 * cuenta como resultado: lo lee de la plataforma.
 */
export type Metricas = {
  readonly gasto: number;
  readonly impresiones: number;
  readonly clics: number;
  readonly conversiones: number;
  /** Valor de esas conversiones, si la cuenta lo mide (ventas). */
  readonly valorConversiones?: number;
};

export type EstadoCampana = "activa" | "pausada" | "finalizada" | "borrador";

export type Campana = {
  readonly id: string;
  readonly nombre: string;
  readonly estado: EstadoCampana;
  /** Presupuesto diario en la moneda de la cuenta, si la campaña lo tiene. */
  readonly presupuestoDiario?: number;
  readonly metricas: Metricas;
};

export type CambioPresupuesto = {
  readonly campanaId: string;
  readonly anterior: number;
  readonly nuevo: number;
};

export type CambioEstado = {
  readonly campanaId: string;
  readonly anterior: EstadoCampana;
  readonly nuevo: EstadoCampana;
};

/**
 * Una plataforma de anuncios conectada.
 *
 * Escribir es opcional: una conexión puede quedarse en solo lectura (por
 * permisos de la plataforma o por decisión del cliente) y el agente tiene que
 * saber decirlo en vez de fallar con un error técnico.
 */
export interface AdsPort {
  readonly plataforma: Plataforma;
  /** false cuando la conexión solo permite leer. */
  readonly puedeEscribir: boolean;
  cuentas(): Promise<readonly CuentaPublicitaria[]>;
  campanas(input: { cuentaId: string; periodo: Periodo }): Promise<readonly Campana[]>;
  cambiarPresupuesto(input: {
    cuentaId: string;
    campanaId: string;
    diario: number;
  }): Promise<CambioPresupuesto>;
  cambiarEstado(input: {
    cuentaId: string;
    campanaId: string;
    estado: "activa" | "pausada";
  }): Promise<CambioEstado>;
}

export type CanalWeb = {
  readonly nombre: string;
  readonly sesiones: number;
  readonly conversiones: number;
};

export type ResumenWeb = {
  readonly propiedadId: string;
  readonly periodo: Periodo;
  readonly sesiones: number;
  readonly usuarios: number;
  readonly conversiones: number;
  readonly canales: readonly CanalWeb[];
};

export interface AnalyticsPort {
  propiedades(): Promise<readonly { id: string; nombre: string }[]>;
  resumen(input: { propiedadId: string; periodo: Periodo }): Promise<ResumenWeb>;
}

// ---------------------------------------------------------------------------
// Aprobación humana y backups (misma forma que en el Webmaster, a propósito)
// ---------------------------------------------------------------------------

export type ApprovalDecision = "aprobada" | "rechazada";

export type ApprovalRequest = {
  readonly id: string;
  readonly decision: ApprovalDecision | null;
};

export interface ApprovalPort {
  check(input: { workspaceId: string; taskId: string; huella: string }): Promise<ApprovalDecision | null>;
  request(input: {
    workspaceId: string;
    taskId: string;
    siteId: string;
    huella: string;
    toolSlug: string;
    motivo: string;
    resumen: string;
    entrada: unknown;
  }): Promise<ApprovalRequest>;
}

export interface BackupPort {
  create(input: {
    workspaceId: string;
    siteId: string;
    taskId: string;
    alcance: string;
    snapshot: unknown;
  }): Promise<string>;
  read(input: { workspaceId: string; backupId: string }): Promise<{
    readonly id: string;
    readonly alcance: string;
    readonly snapshot: unknown;
    readonly creadoEn: string;
  } | null>;
}

// ---------------------------------------------------------------------------
// Contexto de trabajo
// ---------------------------------------------------------------------------

/**
 * Lo que el runtime inyecta en cada ejecución. NADA de esto puede venir del
 * modelo: si el modelo pudiera elegir la cuenta publicitaria, una inyección de
 * prompt sería gastar el dinero de otro cliente.
 */
export type CuentasContext = {
  /** Id de la conexión principal del encargo: la que se guarda en `agent_tasks`. */
  readonly conexionId: string;
  readonly taskId: string;
  /** Una por plataforma conectada. Vacío = no hay nada conectado todavía. */
  readonly ads: readonly AdsPort[];
  readonly analytics?: AnalyticsPort;
  readonly approvals: ApprovalPort;
  readonly backups?: BackupPort;
  /** Para escribir las cifras como las lee el cliente cuando la cuenta no lo dice. */
  readonly monedaPorDefecto?: string;
  /**
   * Primer contacto: el agente mira y propone, no cambia nada. Igual que en el
   * Webmaster, el primer día con la cuenta de un cliente no puede ser también
   * el primer día en que le movemos el presupuesto.
   */
  readonly primerContacto?: boolean;
};

export function adsDe(cuentas: CuentasContext, plataforma: Plataforma, toolSlug: string): AdsPort {
  const puerto = cuentas.ads.find((a) => a.plataforma === plataforma);
  if (!puerto) {
    throw new Error(
      `"${toolSlug}" necesita ${NOMBRE_PLATAFORMA[plataforma]} conectado y este espacio no lo tiene. ` +
        `Dile al cliente que lo conecte en Ajustes → Canales.`,
    );
  }
  return puerto;
}

export function requireAnalytics(cuentas: CuentasContext, toolSlug: string): AnalyticsPort {
  if (!cuentas.analytics) {
    throw new Error(
      `"${toolSlug}" necesita Google Analytics conectado y este espacio no lo tiene. ` +
        `Dile al cliente que lo conecte en Ajustes → Canales.`,
    );
  }
  return cuentas.analytics;
}
