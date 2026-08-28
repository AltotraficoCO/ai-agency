/**
 * Tarifas y conversión de uso a créditos.
 *
 * Un crédito = 0,001 USD de PRECIO DE VENTA. La tabla de tarifas ya lleva el
 * margen dentro: aquí no se calcula coste de proveedor, se calcula lo que se
 * le cobra al workspace. Los identificadores de modelo son datos, nunca
 * literales dentro de la lógica.
 */

/** Valor de un crédito en dólares de venta. */
export const CREDIT_USD = 0.001;

/** Uso normalizado del AI SDK, reducido a lo que se factura. */
export type NormalizedUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens de entrada servidos desde caché (más baratos). */
  readonly cacheReadTokens?: number;
  /** Tokens de entrada escritos en caché (a menudo más caros que la entrada normal). */
  readonly cacheWriteTokens?: number;
};

/** Precio de venta en USD por millón de tokens. */
export type ModelRate = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
};

export type RateTable = {
  /** Clave: identificador de modelo tal cual se pide al proveedor. */
  readonly models: Readonly<Record<string, ModelRate>>;
  /** Tarifa aplicada a un modelo que no está en la tabla. */
  readonly fallback: ModelRate;
  /** Precio de venta fijo en créditos por invocación de herramienta. */
  readonly tools?: Readonly<Record<string, number>>;
};

export type CreditQuote = {
  /** Créditos enteros a cobrar. Siempre se redondea hacia arriba. */
  readonly credits: number;
  /** Precio de venta exacto antes de redondear, para auditoría. */
  readonly usd: number;
  readonly model: string;
  /** true si el modelo no estaba en la tabla y se usó la tarifa por defecto. */
  readonly usedFallback: boolean;
};

/**
 * Normaliza el `usage` del AI SDK v6. Sus campos son `number | undefined`,
 * y el detalle de caché vive en `inputTokenDetails`. Los tokens cacheados ya
 * vienen incluidos en `inputTokens`, así que se restan antes de tarificar
 * para no cobrarlos dos veces.
 */
export function normalizeUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
    noCacheTokens?: number | undefined;
  };
}): NormalizedUsage {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const totalInput = usage.inputTokens ?? 0;
  const noCache = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, totalInput - cacheRead - cacheWrite);
  return {
    inputTokens: noCache,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

export function creditsForUsage(table: RateTable, model: string, usage: NormalizedUsage): CreditQuote {
  const known = table.models[model];
  const rate = known ?? table.fallback;
  const perMillion = (tokens: number, price: number) => (tokens / 1_000_000) * price;

  const usd =
    perMillion(usage.inputTokens, rate.input) +
    perMillion(usage.outputTokens, rate.output) +
    perMillion(usage.cacheReadTokens ?? 0, rate.cacheRead ?? rate.input) +
    perMillion(usage.cacheWriteTokens ?? 0, rate.cacheWrite ?? rate.input);

  return {
    credits: usdToCredits(usd),
    usd,
    model,
    usedFallback: known === undefined,
  };
}

/**
 * Convierte dólares de venta a créditos enteros. Se redondea hacia arriba, y
 * cualquier consumo mayor que cero cuesta al menos un crédito: cobrar cero por
 * trabajo real hace que la contabilidad no cuadre nunca.
 */
export function usdToCredits(usd: number): number {
  if (usd <= 0) return 0;
  return Math.max(1, Math.ceil(usd / CREDIT_USD));
}

export function creditsForTool(table: RateTable, toolSlug: string, declaredCost: number): number {
  return table.tools?.[toolSlug] ?? declaredCost;
}
