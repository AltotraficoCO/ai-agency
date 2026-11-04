/** Puro: de qué saldo sale un descuento manual. Primero lo incluido, como un cobro normal. */
export function repartirDescuento(
  incluido: number,
  comprado: number,
  creditos: number,
): { incluido: number; comprado: number } | null {
  const deIncluido = Math.max(0, incluido);
  const deComprado = Math.max(0, comprado);
  if (creditos > deIncluido + deComprado) return null;
  const primero = Math.min(deIncluido, creditos);
  return { incluido: primero, comprado: creditos - primero };
}
