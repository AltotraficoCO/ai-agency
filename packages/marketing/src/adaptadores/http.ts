/**
 * Lo que comparten los tres adaptadores de plataformas de anuncios.
 *
 * Aquí no hay nada propio de Google, de Meta ni de TikTok: solo lo que las tres
 * necesitan igual y que, escrito tres veces, se habría desviado tres veces.
 *
 *  · `fetch` inyectable y con timeout. Sin eso no se puede probar un adaptador
 *    sin credenciales reales, y un adaptador que solo se prueba a mano no se
 *    prueba. El timeout es duro: una plataforma que tarda un minuto en
 *    responder bloquea el encargo entero.
 *  · Errores con el cuerpo recortado. Un 400 de Google Ads sin su cuerpo es
 *    indistinguible de un 400 de Meta; con él se entiende sin entrar a la
 *    consola de nadie.
 *  · Números tolerantes. Las tres APIs devuelven cifras como texto en sitios
 *    distintos y un `NaN` colado en el gasto se convierte en un consejo
 *    inventado sobre el dinero del cliente.
 */

export type Fetch = typeof globalThis.fetch;

export type OpcionesAds = {
  readonly fetch?: Fetch;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  /**
   * La conexión solo permite mirar. Puede venir del permiso que dio la
   * plataforma o de que el cliente no quiera que nadie le mueva el dinero.
   */
  readonly soloLectura?: boolean;
};

const TIMEOUT_POR_DEFECTO = 20_000;

/** Une la señal externa (el tope duro de la tarea) con la del propio timeout. */
export function senal(o: OpcionesAds): AbortSignal {
  const propia = AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_POR_DEFECTO);
  return o.abortSignal ? AbortSignal.any([propia, o.abortSignal]) : propia;
}

export class AdsApiError extends Error {
  constructor(
    readonly plataforma: string,
    readonly status: number,
    readonly cuerpo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "AdsApiError";
  }
}

/**
 * Hace la petición y devuelve el JSON, o lanza con el cuerpo dentro.
 *
 * `contexto` se escribe en lenguaje de lo que se estaba haciendo («leer las
 * campañas»), no de la ruta: el mensaje acaba en la traza de un encargo que lee
 * una persona.
 */
export async function pedirJson(
  plataforma: string,
  contexto: string,
  o: OpcionesAds,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const f = o.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await f(url, { ...init, signal: senal(o) });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new AdsApiError(plataforma, 0, detalle, `No se pudo ${contexto} en ${plataforma}: ${detalle}`);
  }
  const texto = await res.text();
  if (!res.ok) {
    const cuerpo = texto.slice(0, 400);
    throw new AdsApiError(
      plataforma,
      res.status,
      cuerpo,
      `${plataforma} rechazó ${contexto} (${res.status}): ${resumirError(texto)}`,
    );
  }
  if (!texto) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new AdsApiError(
      plataforma,
      res.status,
      texto.slice(0, 400),
      `${plataforma} respondió algo que no es JSON al ${contexto}.`,
    );
  }
}

/** Un número venga como venga: número, texto o ausente. Nunca `NaN`. */
export function numero(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === "string") {
    const n = Number.parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function texto(valor: unknown, porDefecto = ""): string {
  return typeof valor === "string" && valor.length > 0 ? valor : porDefecto;
}

/**
 * Monedas que no tienen céntimos.
 *
 * Meta y TikTok guardan los presupuestos en la unidad mínima de la moneda, así
 * que 50.000 pesos son «50000» en pesos colombianos y «5000000» en dólares. Sin
 * esta tabla, un presupuesto en pesos se dividiría entre cien y el agente le
 * diría al cliente que gasta 500 pesos al día.
 *
 * La lista es la de ISO 4217 con cero decimales, quitando las que ninguna de
 * las plataformas admite como moneda de cuenta.
 */
const SIN_DECIMALES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF", "COP", "HUF", "TWD",
]);

/** Cuántos decimales tiene la moneda en la unidad mínima de la plataforma. */
export function decimalesDe(moneda: string): number {
  return SIN_DECIMALES.has(moneda.toUpperCase()) ? 0 : 2;
}

/** De la unidad mínima de la plataforma a la cifra que lee el cliente. */
export function desdeUnidadMinima(valor: unknown, moneda: string): number {
  const factor = 10 ** decimalesDe(moneda);
  return numero(valor) / factor;
}

/** De la cifra que escribe el cliente a la unidad mínima de la plataforma. */
export function aUnidadMinima(valor: number, moneda: string): number {
  return Math.round(valor * 10 ** decimalesDe(moneda));
}

/**
 * Un periodo que no pide cifras, solo el catálogo de campañas.
 *
 * Las herramientas de cambio (`ads_cambiar_presupuesto`, `ads_pausar_campana`)
 * piden las campañas con un periodo imposible de 1970 porque solo quieren saber
 * cómo se llama la campaña y cuánto tiene puesto hoy. Pedirle a Google las
 * métricas de 1970 es un error de la API, y pedírselas a Meta es un viaje de
 * más por cada campaña: se detecta aquí y se salta la consulta de cifras.
 */
export function soloCatalogo(periodo: { desde: string; hasta: string }): boolean {
  return periodo.hasta < "2000-01-01";
}

export const METRICAS_VACIAS = {
  gasto: 0,
  impresiones: 0,
  clics: 0,
  conversiones: 0,
} as const;

/**
 * Lo que de verdad dice un error, sin el envoltorio.
 *
 * Google Ads contesta un `error.message` genérico («Request contains an
 * invalid argument») y esconde la causa en `error.details[].errors[]`, que
 * con un recorte a 400 caracteres nunca llegaba a verse. Meta la pone en
 * `error.message` directamente. Si no es JSON, se recorta el texto y ya.
 */
export function resumirError(texto: string): string {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return texto.slice(0, 400);
  }
  const error = (datos as { error?: unknown })?.error;
  if (!error || typeof error !== "object") return texto.slice(0, 400);
  const e = error as { message?: unknown; details?: unknown };

  const causas: string[] = [];
  for (const detalle of Array.isArray(e.details) ? e.details : []) {
    const errores = (detalle as { errors?: unknown })?.errors;
    for (const err of Array.isArray(errores) ? errores : []) {
      const x = err as { message?: unknown; errorCode?: unknown };
      const codigo = x.errorCode && typeof x.errorCode === "object" ? Object.values(x.errorCode)[0] : undefined;
      const mensaje = typeof x.message === "string" ? x.message : "";
      if (mensaje) causas.push(typeof codigo === "string" ? `${mensaje} [${codigo}]` : mensaje);
    }
  }
  if (causas.length > 0) return causas.join(" · ").slice(0, 400);
  return (typeof e.message === "string" ? e.message : texto).slice(0, 400);
}
