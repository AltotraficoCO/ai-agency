/**
 * El guion de Strap.
 *
 * Ocho fases, en orden, y una sola manera de avanzar. La fase NO vive en el
 * historial del chat: vive en el borrador, junto al `spec`. Por eso cerrar el
 * navegador y volver mañana retoma exactamente donde ibas — el chat es la
 * ventana, el borrador es el estado.
 */

export type FaseMeta =
  | "intencion"
  | "recoleccion_1"
  | "recoleccion_2"
  | "confirmacion"
  | "construccion"
  | "reporte"
  | "prueba"
  | "entrega";

export const FASES_META = [
  "intencion",
  "recoleccion_1",
  "recoleccion_2",
  "confirmacion",
  "construccion",
  "reporte",
  "prueba",
  "entrega",
] as const satisfies readonly FaseMeta[];

export const ETIQUETA_FASE: Readonly<Record<FaseMeta, string>> = {
  intencion: "Entendiendo qué necesitas",
  recoleccion_1: "Conociendo tu empresa",
  recoleccion_2: "Definiendo el agente",
  confirmacion: "Confirmando antes de construir",
  construccion: "Construyendo",
  reporte: "Contándote qué quedó",
  prueba: "Probando el agente",
  entrega: "Listo",
};

export function esFaseMeta(valor: unknown): valor is FaseMeta {
  return typeof valor === "string" && (FASES_META as readonly string[]).includes(valor);
}

/** La fase siguiente. La última se queda donde está: entregar es el final. */
export function siguienteFase(fase: FaseMeta): FaseMeta {
  const i = FASES_META.indexOf(fase);
  return FASES_META[Math.min(i + 1, FASES_META.length - 1)] ?? "entrega";
}

export function faseAlcanzada(actual: FaseMeta, objetivo: FaseMeta): boolean {
  return FASES_META.indexOf(actual) >= FASES_META.indexOf(objetivo);
}

/**
 * Traducción a `agent_drafts.phase`.
 *
 * La columna tiene un CHECK con su propio vocabulario, más grueso que estas
 * ocho fases. La fase fina es la de arriba y se guarda en `progress`; esta
 * proyección existe para que una consulta SQL directa sobre `phase` siga
 * diciendo algo cierto, no para que nadie la lea como fuente de verdad.
 */
const A_COLUMNA: Readonly<Record<FaseMeta, string>> = {
  intencion: "discovery",
  recoleccion_1: "company",
  recoleccion_2: "persona",
  confirmacion: "review",
  construccion: "review",
  reporte: "review",
  prueba: "review",
  entrega: "published",
};

export function faseParaColumna(fase: FaseMeta): string {
  return A_COLUMNA[fase] ?? "discovery";
}
