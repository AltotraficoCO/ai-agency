const NOMBRES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «2026-11» → «nov 26». Lo usan el gráfico (cliente) y la tabla (servidor). */
export function mesCorto(mes: string): string {
  const [anio, numero] = mes.split("-");
  return `${NOMBRES[Number(numero) - 1] ?? mes} ${anio?.slice(2) ?? ""}`;
}
