/**
 * La suma de lo pagado en el mes, aislada y pura.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SOLO ENTRAN DOS SUMANDOS, Y NINGUNO ES DE META
 * ════════════════════════════════════════════════════════════════════════════
 * El total que ve el cliente es agentes contratados + recargas. Punto.
 *
 * El gasto de mensajería de WhatsApp NO entra, y la firma de esta función es la
 * barrera: no hay ningún parámetro donde meterlo. Si alguien quisiera sumarlo
 * tendría que cambiar el tipo, y al cambiarlo leería este comentario.
 *
 * Somos Tech Provider: ese gasto lo cobra Meta directamente al cliente, con su
 * método de pago, sobre su propia cuenta. Sumarlo aquí le diría que se lo
 * cobramos nosotros, que es exactamente la confusión que más tickets genera en
 * este modelo de negocio.
 */
export type SumandosFactura = {
  /** Fijo mensual de los agentes del catálogo contratados y activos. */
  readonly agentesUsd: number;
  /** Recargas de crédito abonadas dentro del mes. */
  readonly recargasUsd: number;
};

export type ResumenFactura = SumandosFactura & {
  readonly totalUsd: number;
};

export function combinarFactura(sumandos: SumandosFactura): ResumenFactura {
  const totalUsd = redondear(sumandos.agentesUsd + sumandos.recargasUsd);
  return { ...sumandos, totalUsd };
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
