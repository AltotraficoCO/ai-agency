/**
 * Rangos de fechas de la analítica.
 *
 * Todo se calcula sobre DÍAS COMPLETOS en la zona del espacio, no sobre
 * instantes: `usage_daily` y `waba_analytics_daily` guardan un `date`, y
 * comparar un `date` con un `timestamptz` es la forma más rápida de que el
 * primer día del mes aparezca o desaparezca según el huso del servidor.
 *
 * El «periodo anterior» es siempre del MISMO número de días e inmediatamente
 * antes. Un delta contra un periodo de otra longitud no significa nada.
 */

export type ClaveAtajo = "hoy" | "7d" | "30d" | "mes";

export type RangoDias = {
  /** Primer día incluido, en formato ISO `YYYY-MM-DD`. */
  readonly desde: string;
  /** Último día incluido, en formato ISO `YYYY-MM-DD`. */
  readonly hasta: string;
};

export const ATAJOS: readonly { clave: ClaveAtajo; etiqueta: string }[] = [
  { clave: "hoy", etiqueta: "Hoy" },
  { clave: "7d", etiqueta: "7 días" },
  { clave: "30d", etiqueta: "30 días" },
  { clave: "mes", etiqueta: "Este mes" },
];

const DIA_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` del instante dado, leído en la zona horaria indicada. */
export function diaEnZona(instante: Date, zona: string): string {
  // `en-CA` da exactamente `YYYY-MM-DD`, que es lo que entiende Postgres.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** Suma (o resta, con negativo) días a un `YYYY-MM-DD` sin tocar husos. */
export function sumarDias(dia: string, dias: number): string {
  const base = Date.parse(`${dia}T00:00:00Z`);
  return new Date(base + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Días incluidos en el rango, contando ambos extremos. */
export function longitudEnDias(rango: RangoDias): number {
  const a = Date.parse(`${rango.desde}T00:00:00Z`);
  const b = Date.parse(`${rango.hasta}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / DIA_MS) + 1);
}

/** Lista de días del rango, para rellenar los huecos de las gráficas. */
export function diasDelRango(rango: RangoDias): string[] {
  const total = longitudEnDias(rango);
  const dias: string[] = [];
  for (let i = 0; i < total; i += 1) dias.push(sumarDias(rango.desde, i));
  return dias;
}

export function rangoDeAtajo(clave: ClaveAtajo, ahora: Date, zona: string): RangoDias {
  const hoy = diaEnZona(ahora, zona);
  switch (clave) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "7d":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30d":
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "mes":
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  }
}

/**
 * El rango equivalente inmediatamente anterior, misma longitud.
 * Es contra este contra el que se calculan los deltas de las tarjetas.
 */
export function periodoAnterior(rango: RangoDias): RangoDias {
  const dias = longitudEnDias(rango);
  return { desde: sumarDias(rango.desde, -dias), hasta: sumarDias(rango.desde, -1) };
}

/** Lee el rango de los parámetros de la URL; cae al atajo por defecto. */
export function rangoDesdeParametros(
  parametros: { desde?: string | undefined; hasta?: string | undefined; atajo?: string | undefined },
  ahora: Date,
  zona: string,
): { rango: RangoDias; atajo: ClaveAtajo | null } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (parametros.desde && parametros.hasta && iso.test(parametros.desde) && iso.test(parametros.hasta)) {
    const [desde, hasta] =
      parametros.desde <= parametros.hasta
        ? [parametros.desde, parametros.hasta]
        : [parametros.hasta, parametros.desde];
    return { rango: { desde, hasta }, atajo: null };
  }
  const clave = ATAJOS.find((a) => a.clave === parametros.atajo)?.clave ?? "30d";
  return { rango: rangoDeAtajo(clave, ahora, zona), atajo: clave };
}

const FORMATO_DIA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });

/** «1 ago – 30 ago» para el encabezado del selector. */
export function etiquetaDeRango(rango: RangoDias): string {
  const uno = FORMATO_DIA.format(new Date(`${rango.desde}T12:00:00Z`));
  if (rango.desde === rango.hasta) return uno;
  return `${uno} – ${FORMATO_DIA.format(new Date(`${rango.hasta}T12:00:00Z`))}`;
}
