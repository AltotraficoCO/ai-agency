/**
 * Créditos: proyección, umbrales y traducción a lenguaje llano.
 *
 * Módulo PURO a propósito. Es lo que responde a la única pregunta que hace un
 * cliente no técnico —«¿cuánto voy a pagar este mes?»— y por eso se prueba
 * sola, sin base de datos: una proyección mal calculada es una factura
 * sorpresa, que es exactamente lo que este producto promete evitar.
 */

/** 1 crédito = 0,001 USD de precio de venta. */
export const USD_POR_CREDITO = 0.001;

/** A partir de aquí avisamos por correo y por banner. */
export const UMBRAL_AVISO = 0.8;

export type Proyeccion = {
  /** Créditos gastados en lo que va de periodo. */
  readonly consumidos: number;
  /** Créditos disponibles en el periodo (incluidos + comprados). */
  readonly asignados: number;
  /** Fracción de periodo ya transcurrida, entre 0 y 1. */
  readonly avancePeriodo: number;
  /** Consumo estimado al cierre del periodo, al ritmo actual. */
  readonly proyectado: number;
  /** `proyectado / asignados`. Puede pasar de 1. */
  readonly porcentajeProyectado: number;
  /** `consumidos / asignados`, lo ya gastado. */
  readonly porcentajeActual: number;
  /** true cuando la proyección se sale del saldo del periodo. */
  readonly excede: boolean;
  /** Créditos que faltarían si se cumple la proyección. 0 si no excede. */
  readonly excedente: number;
  /**
   * false cuando el periodo acaba de empezar y la muestra es demasiado corta
   * para proyectar nada. Sin esto, gastar 300 créditos el día 1 proyecta 9.000
   * y el banner rojo aparece sin motivo.
   */
  readonly fiable: boolean;
};

/** Bajo este avance del periodo, proyectar es adivinar. */
const AVANCE_MINIMO_FIABLE = 0.1;

/**
 * Proyecta el consumo al cierre del periodo por regla de tres sobre el tiempo
 * transcurrido.
 *
 * Se usa el tiempo REAL transcurrido, no los días naturales: si son las 10 de
 * la mañana del día 3 de un mes de 30, el periodo lleva un 7,3% y no un 10%, y
 * redondear a días hincha la proyección casi un 40% el primer día del mes.
 */
export function proyectarConsumo(entrada: {
  consumidos: number;
  asignados: number;
  inicioPeriodo: Date;
  finPeriodo: Date;
  ahora: Date;
}): Proyeccion {
  const consumidos = Math.max(0, entrada.consumidos);
  const asignados = Math.max(0, entrada.asignados);

  const total = entrada.finPeriodo.getTime() - entrada.inicioPeriodo.getTime();
  const transcurrido = entrada.ahora.getTime() - entrada.inicioPeriodo.getTime();

  // Un periodo de duración cero o negativa no es proyectable: se devuelve lo
  // consumido tal cual en vez de dividir por cero.
  const avance = total > 0 ? Math.min(1, Math.max(0, transcurrido / total)) : 1;
  const fiable = avance >= AVANCE_MINIMO_FIABLE;

  const proyectado = avance > 0 ? Math.round(consumidos / avance) : consumidos;
  const porcentajeProyectado = asignados > 0 ? proyectado / asignados : 0;
  const porcentajeActual = asignados > 0 ? consumidos / asignados : 0;
  const excede = asignados > 0 && proyectado > asignados;

  return {
    consumidos,
    asignados,
    avancePeriodo: avance,
    proyectado,
    porcentajeProyectado,
    porcentajeActual,
    excede,
    excedente: excede ? proyectado - asignados : 0,
    fiable,
  };
}

export type EstadoSaldo = "sano" | "aviso" | "agotado";

/**
 * En qué punto está el saldo.
 *
 * `agotado` no significa «apagamos la cuenta»: significa que el bot deja de
 * responder solo. La bandeja, los contactos y el histórico siguen funcionando.
 * Ver `limites.ts`.
 */
export function estadoDelSaldo(consumidos: number, asignados: number): EstadoSaldo {
  if (asignados <= 0) return "agotado";
  const fraccion = consumidos / asignados;
  if (fraccion >= 1) return "agotado";
  if (fraccion >= UMBRAL_AVISO) return "aviso";
  return "sano";
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
 * La frase de la proyección, ya redactada.
 *
 * Se redacta aquí y no en el componente porque es la frase que decide si el
 * cliente entiende su factura, y tiene que decir lo mismo en el panel, en el
 * correo de aviso y en la pantalla de facturación.
 */
export function fraseDeProyeccion(p: Proyeccion): string {
  if (!p.fiable) {
    return "Todavía es pronto en el periodo para proyectar el cierre con fiabilidad.";
  }
  if (p.excede) {
    return `Al ritmo actual terminarás el mes en ${creditosCompactos(p.proyectado)} (${porcentaje(
      p.porcentajeProyectado,
    )}): te faltarían ${creditosCompactos(p.excedente)} créditos.`;
  }
  return `Al ritmo actual terminarás el mes en ${creditosCompactos(p.proyectado)} (${porcentaje(
    p.porcentajeProyectado,
  )}).`;
}

/**
 * Qué es un crédito, en lenguaje de USO y no de precio.
 *
 * Aquí NO se publica la equivalencia crédito → dólar: el precio de cada modelo
 * cambia y enseñar la tabla de conversión invita a hacer la cuenta del margen.
 * El cliente compra créditos a un precio que ya conoce por su plan o su
 * recarga; lo que necesita en estas pantallas es saber cuánto le rinden.
 */
export const QUE_ES_UN_CREDITO =
  "1 crédito ≈ una respuesta corta de la IA. Cada tarea consume los créditos que necesita.";
