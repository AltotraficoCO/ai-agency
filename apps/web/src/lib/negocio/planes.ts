/**
 * Catálogo comercial: planes y paquetes de recarga.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE DECIDE AQUÍ Y QUÉ NO
 * ────────────────────────────────────────────────────────────────────────────
 * Aquí vive el PRECIO DEL PLAN (una cuota fija que el cliente firma) y cuántos
 * créditos incluye. NO vive aquí ningún precio de consumo: cuánto cuesta un
 * token, una herramienta o un mensaje sale siempre de `credit_rates`, que está
 * versionada por `effective_from`. Si algún día ves una multiplicación de
 * tokens por un número escrito en un archivo `.ts`, es un error.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LAS CLAVES DE BASE DE DATOS NO SE LLAMAN COMO LOS PLANES
 * ────────────────────────────────────────────────────────────────────────────
 * `subscriptions.plan` tiene un CHECK con los valores
 * `trial|starter|growth|business|enterprise`, escritos antes de que el
 * comercial se cerrara. Renombrarlos exigiría una migración de un esquema que
 * pertenece a otra corriente, así que el nombre comercial y la clave técnica se
 * mapean AQUÍ, en un solo sitio, y en ningún otro se escribe el literal.
 */

/** Valor de venta de un crédito, en dólares. Igual que `@strappy/core`. */
export const USD_POR_CREDITO = 0.001;

/** Clave técnica: exactamente lo que admite el CHECK de `subscriptions.plan`. */
export type ClavePlan = "trial" | "starter" | "growth" | "business" | "enterprise";

export type Plan = {
  readonly clave: ClavePlan;
  /** Nombre comercial, el único que ve el cliente. */
  readonly nombre: string;
  readonly precioUsd: number;
  readonly creditosIncluidos: number;
  readonly resumen: string;
  readonly incluye: readonly string[];
  /** Precio de Stripe. Sin clave configurada la interfaz sigue renderizando. */
  readonly precioStripeEnv: string;
  readonly destacado?: boolean;
};

export const PLANES: readonly Plan[] = [
  {
    clave: "trial",
    nombre: "Free",
    precioUsd: 0,
    creditosIncluidos: 2_000,
    resumen: "Para probar el producto con conversaciones reales, sin tarjeta.",
    incluye: [
      "2.000 créditos al mes",
      "Un agente publicado",
      "Bandeja compartida con tu equipo",
      "Tu propio WhatsApp conectado",
    ],
    precioStripeEnv: "STRIPE_PRECIO_FREE",
  },
  {
    clave: "starter",
    nombre: "Pro",
    precioUsd: 99,
    creditosIncluidos: 100_000,
    resumen: "Un negocio que ya atiende todos los días por WhatsApp.",
    incluye: [
      "100.000 créditos al mes",
      "Agentes ilimitados",
      "Analítica completa y exportable",
      "Recargas que no caducan",
    ],
    precioStripeEnv: "STRIPE_PRECIO_PRO",
    destacado: true,
  },
  {
    clave: "growth",
    nombre: "Scale-Up",
    precioUsd: 499,
    creditosIncluidos: 500_000,
    resumen: "Varios equipos, varios números y volumen sostenido.",
    incluye: [
      "500.000 créditos al mes",
      "Varios números de WhatsApp",
      "Roles y equipos",
      "Modo max en los agentes que lo necesiten",
    ],
    precioStripeEnv: "STRIPE_PRECIO_SCALEUP",
  },
  {
    clave: "business",
    nombre: "Prime",
    precioUsd: 1_499,
    creditosIncluidos: 1_500_000,
    resumen: "Operación grande con acompañamiento y acuerdos de servicio.",
    incluye: [
      "1.500.000 créditos al mes",
      "Acompañamiento en la puesta en marcha",
      "Acuerdo de nivel de servicio",
      "Facturación consolidada",
    ],
    precioStripeEnv: "STRIPE_PRECIO_PRIME",
  },
];

export function planPorClave(clave: string | null | undefined): Plan {
  return PLANES.find((p) => p.clave === clave) ?? PLANES[0]!;
}

/**
 * Del identificador de precio de Stripe al plan.
 *
 * El webhook llega con un `price_...` y sin nada más: es la única forma de
 * saber qué compró el cliente. Se resuelve contra las mismas variables de
 * entorno que se usaron para crear la sesión, así que no hay una segunda tabla
 * que mantener sincronizada.
 */
export function planPorPrecioStripe(precioId: string | null | undefined): Plan | null {
  if (!precioId) return null;
  return PLANES.find((p) => process.env[p.precioStripeEnv] === precioId) ?? null;
}

export function recargaPorPrecioStripe(precioId: string | null | undefined): Recarga | null {
  if (!precioId) return null;
  return RECARGAS.find((r) => process.env[r.precioStripeEnv] === precioId) ?? null;
}

/** Paquete de recarga. Los créditos comprados NO caducan: nunca. */
export type Recarga = {
  readonly clave: string;
  readonly creditos: number;
  readonly precioUsd: number;
  readonly precioStripeEnv: string;
};

/**
 * Las recargas se venden al mismo precio unitario que el plan Pro (0,00099
 * USD/crédito), sin descuento por volumen: el descuento por volumen es lo que
 * distingue a un plan superior, y si la recarga lo igualara nadie subiría de
 * plan.
 */
export const RECARGAS: readonly Recarga[] = [
  { clave: "r25", creditos: 25_000, precioUsd: 25, precioStripeEnv: "STRIPE_PRECIO_RECARGA_25" },
  { clave: "r100", creditos: 100_000, precioUsd: 99, precioStripeEnv: "STRIPE_PRECIO_RECARGA_100" },
  { clave: "r500", creditos: 500_000, precioUsd: 475, precioStripeEnv: "STRIPE_PRECIO_RECARGA_500" },
];

export function recargaPorClave(clave: string | null | undefined): Recarga | null {
  return RECARGAS.find((r) => r.clave === clave) ?? null;
}

/** Créditos → dólares de venta. La única conversión, y va en un solo sitio. */
export function creditosAUsd(creditos: number): number {
  return creditos * USD_POR_CREDITO;
}
