/**
 * Créditos: estado del saldo, ritmo de gasto y traducción a lenguaje llano.
 *
 * Módulo PURO a propósito. El crédito es prepago: lo que el cliente necesita
 * saber no es cómo acabará el mes, sino cuánto le queda y para cuánto le alcanza.
 */
import { USD_POR_CREDITO } from "@strappy/core/recargas";

export { USD_POR_CREDITO };

/** Créditos → dólares de venta. La única conversión, y va en un solo sitio. */
export function creditosAUsd(creditos: number): number {
  return creditos * USD_POR_CREDITO;
}

/**
 * `sin_recargar`: no hay saldo y nunca hubo recarga. No es lo mismo que agotarse:
 * a quien acaba de llegar no se le dice que se quedó sin nada.
 *
 * `agotado` no significa «apagamos la cuenta»: significa que el bot deja de
 * responder solo. La bandeja, los contactos y el histórico siguen funcionando.
 * Ver `limites.ts`.
 */
export type EstadoSaldo = "sano" | "aviso" | "agotado" | "sin_recargar";

export function estadoDelSaldo(entrada: {
  disponible: number;
  umbralAviso: number;
  haRecargado: boolean;
}): EstadoSaldo {
  if (entrada.disponible <= 0) return entrada.haRecargado ? "agotado" : "sin_recargar";
  return entrada.disponible < entrada.umbralAviso ? "aviso" : "sano";
}

/** Bajo estos días de historial, el ritmo de gasto todavía no dice nada. */
const DIAS_MINIMOS_DE_RITMO = 3;
const VENTANA_DE_RITMO = 30;

/**
 * Para cuántos días alcanza el saldo al ritmo reciente. `null` si no se puede
 * saber: un día de pruebas intensas no es un ritmo, y prometer «te queda un día»
 * con esa muestra asusta sin motivo.
 */
export function diasDeSaldo(entrada: {
  disponible: number;
  /** Créditos gastados en los últimos 30 días. */
  gastados: number;
  /** Días transcurridos desde el primer gasto de esa ventana. */
  diasDeHistorial: number;
}): number | null {
  if (entrada.gastados <= 0 || entrada.diasDeHistorial < DIAS_MINIMOS_DE_RITMO) return null;
  const dias = Math.min(entrada.diasDeHistorial, VENTANA_DE_RITMO);
  return Math.floor(Math.max(0, entrada.disponible) / (entrada.gastados / dias));
}

export function fraseDeRitmo(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias < 1) return "Al ritmo de los últimos días, tu saldo no alcanza para un día más.";
  if (dias === 1) return "Al ritmo de los últimos días, tu saldo alcanza para 1 día.";
  return `Al ritmo de los últimos días, tu saldo alcanza para unos ${dias} días.`;
}

// ── Formato ─────────────────────────────────────────────────────────────────

const COMPACTO = new Intl.NumberFormat("es-CO", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const ENTERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const DOLAR = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** «12,4 K» — la forma en que aparecen los créditos en toda la interfaz. */
export function creditosCompactos(valor: number): string {
  if (Math.abs(valor) < 1000) return ENTERO.format(Math.round(valor));
  // `es-CO` abrevia como «41 k» / «1,5 mil». En la interfaz la unidad va en
  // mayúscula y con espacio fino delante, igual en toda la aplicación.
  return COMPACTO.format(valor)
    .replace(/\s*mil\b/i, " K")
    .replace(/\s*k\b/i, " K")
    .replace(/\s*M\b/, " M")
    .trim();
}

export function creditosExactos(valor: number): string {
  return ENTERO.format(Math.round(valor));
}

export function dolares(valor: number): string {
  return DOLAR.format(valor);
}

export function creditosEnDolares(creditos: number): string {
  return DOLAR.format(creditos * USD_POR_CREDITO);
}

export function porcentaje(fraccion: number): string {
  return `${Math.round(fraccion * 100)}%`;
}

/**
 * Qué es un crédito, en lenguaje de USO y no de precio.
 *
 * Aquí NO se publica la equivalencia crédito → dólar: el precio de cada modelo
 * cambia y enseñar la tabla de conversión invita a hacer la cuenta del margen.
 * El cliente compra créditos a un precio que ya conoce por su recarga; lo que necesita en estas pantallas es saber cuánto le rinden.
 */
export const QUE_ES_UN_CREDITO =
  "1 crédito ≈ una respuesta corta de la IA. Cada tarea consume los créditos que necesita.";
