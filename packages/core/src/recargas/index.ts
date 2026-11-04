/**
 * Recargas: cuánto se puede recargar, cuánto se cobra y qué hacer con cada
 * respuesta de la pasarela.
 *
 * Módulo PURO. Aquí se decide si un cliente recibe créditos, y eso se prueba
 * contra casos con la cuenta hecha a mano, sin base de datos.
 *
 * NO vive aquí ningún precio de consumo: cuánto cuesta un token o una
 * herramienta sale de `credit_rates`.
 */
/** 1 crédito = 0,001 USD de precio de venta. */
export const USD_POR_CREDITO = 0.001;

/**
 * Lo que se configura desde el panel de super admin. Vive en `platform_settings`;
 * estos valores solo aplican mientras nadie haya guardado otros.
 */
export type ConfigCobro = {
  readonly minimoUsd: number;
  readonly maximoUsd: number;
  /** Los montos que se ofrecen en la recarga automática. Siempre se admite uno propio. */
  readonly montosAutomaticos: readonly number[];
  /**
   * Por debajo de esto el saldo cuenta como acabado y salta la recarga automática.
   *
   * No conviene que sea cero: `charge_credits` rechaza un cobro entero si no
   * alcanza, así que el saldo se queda en un pico que no cubre nada y nunca llega
   * a cero exacto.
   */
  readonly umbralSaldoAcabado: number;
  /** Por debajo de esto se avisa al cliente de que le queda poco. */
  readonly umbralAviso: number;
  /** Rechazos seguidos tras los que se deja de insistir. */
  readonly rechazosParaApagar: number;
  /** Un banco no cambia de idea en un minuto. */
  readonly esperaTrasRechazoMin: number;
  /** Freno contra un bucle: tanto gasto debe verlo una persona. */
  readonly cobrosPorDia: number;
};

export const CONFIG_COBRO_POR_DEFECTO: ConfigCobro = {
  minimoUsd: 15,
  maximoUsd: 5_000,
  montosAutomaticos: [20, 50, 100, 300],
  umbralSaldoAcabado: 1_000,
  umbralAviso: 5_000,
  rechazosParaApagar: 3,
  esperaTrasRechazoMin: 60,
  cobrosPorDia: 5,
};

function enteroEntre(valor: unknown, minimo: number, maximo: number): number | null {
  const n = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  return typeof n === "number" && Number.isInteger(n) && n >= minimo && n <= maximo ? n : null;
}

/** Lee lo guardado campo por campo: un dato raro no puede dejar sin cobro al sistema. */
export function normalizarConfigCobro(guardado: unknown): ConfigCobro {
  const r = typeof guardado === "object" && guardado !== null ? (guardado as Record<string, unknown>) : {};
  const d = CONFIG_COBRO_POR_DEFECTO;
  const montos = Array.isArray(r["montosAutomaticos"])
    ? r["montosAutomaticos"].filter((m): m is number => typeof m === "number" && Number.isInteger(m) && m > 0)
    : [];
  return {
    minimoUsd: enteroEntre(r["minimoUsd"], 1, 1_000_000) ?? d.minimoUsd,
    maximoUsd: enteroEntre(r["maximoUsd"], 1, 1_000_000) ?? d.maximoUsd,
    montosAutomaticos: montos.length > 0 ? montos : d.montosAutomaticos,
    umbralSaldoAcabado: enteroEntre(r["umbralSaldoAcabado"], 0, 100_000_000) ?? d.umbralSaldoAcabado,
    umbralAviso: enteroEntre(r["umbralAviso"], 0, 100_000_000) ?? d.umbralAviso,
    rechazosParaApagar: enteroEntre(r["rechazosParaApagar"], 1, 100) ?? d.rechazosParaApagar,
    esperaTrasRechazoMin: enteroEntre(r["esperaTrasRechazoMin"], 1, 10_080) ?? d.esperaTrasRechazoMin,
    cobrosPorDia: enteroEntre(r["cobrosPorDia"], 1, 1_000) ?? d.cobrosPorDia,
  };
}

export type ConfigValidada =
  | { readonly ok: true; readonly config: ConfigCobro }
  | { readonly ok: false; readonly motivo: string };

/** Lo que escribe el super admin. Aquí sí se rechaza: un error debe verlo quien lo comete. */
export function validarConfigCobro(entrada: Record<string, unknown>): ConfigValidada {
  const entero = (clave: string, nombre: string, minimo: number, maximo: number) => {
    const n = enteroEntre(entrada[clave], minimo, maximo);
    if (n === null) throw new Error(`${nombre}: escribe un número entero entre ${minimo} y ${maximo}.`);
    return n;
  };
  try {
    const minimoUsd = entero("minimoUsd", "Recarga mínima", 1, 1_000_000);
    const maximoUsd = entero("maximoUsd", "Recarga máxima", 1, 1_000_000);
    if (maximoUsd < minimoUsd) throw new Error("La recarga máxima no puede ser menor que la mínima.");

    const montos = String(entrada["montosAutomaticos"] ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .map(Number);
    if (montos.length === 0 || montos.some((m) => !Number.isInteger(m))) {
      throw new Error("Montos automáticos: escríbelos en dólares enteros, separados por comas.");
    }
    if (montos.some((m) => m < minimoUsd || m > maximoUsd)) {
      throw new Error("Los montos automáticos deben estar entre la recarga mínima y la máxima.");
    }

    return {
      ok: true,
      config: {
        minimoUsd,
        maximoUsd,
        montosAutomaticos: [...new Set(montos)].sort((a, b) => a - b),
        umbralSaldoAcabado: entero("umbralSaldoAcabado", "Saldo acabado", 0, 100_000_000),
        umbralAviso: entero("umbralAviso", "Aviso de saldo", 0, 100_000_000),
        rechazosParaApagar: entero("rechazosParaApagar", "Rechazos", 1, 100),
        esperaTrasRechazoMin: entero("esperaTrasRechazoMin", "Espera tras rechazo", 1, 10_080),
        cobrosPorDia: entero("cobrosPorDia", "Cobros por día", 1, 1_000),
      },
    };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "Revisa los datos." };
  }
}

export type MontoValidado =
  | { readonly ok: true; readonly usd: number }
  | { readonly ok: false; readonly motivo: string };

/** Solo dólares enteros: así los créditos siempre salen exactos. */
export function validarMonto(valor: unknown, config: ConfigCobro = CONFIG_COBRO_POR_DEFECTO): MontoValidado {
  const usd = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  if (typeof usd !== "number" || !Number.isInteger(usd)) {
    return { ok: false, motivo: "Escribe un monto en dólares, sin decimales." };
  }
  if (usd < config.minimoUsd) return { ok: false, motivo: `La recarga mínima es de ${config.minimoUsd} USD.` };
  if (usd > config.maximoUsd) return { ok: false, motivo: `La recarga máxima es de ${config.maximoUsd} USD.` };
  return { ok: true, usd };
}

export function creditosPorUsd(usd: number): number {
  return Math.round(usd / USD_POR_CREDITO);
}

export type Cotizacion = {
  readonly usd: number;
  readonly creditos: number;
  readonly trm: number;
  /** Pesos enteros, redondeados hacia arriba para no cobrar de menos. */
  readonly pesos: number;
  readonly centavos: number;
};

export function cotizar(usd: number, trm: number): Cotizacion {
  const pesos = Math.ceil(usd * trm);
  return { usd, creditos: creditosPorUsd(usd), trm, pesos, centavos: pesos * 100 };
}

export type EstadoRecarga = "pending" | "approved" | "declined" | "voided" | "error";

export type AccionTransaccion =
  /** Pagado lo cotizado y aún sin abonar: se abona. */
  | { readonly tipo: "abonar" }
  /** Se anota el nuevo estado y no se mueve ningún crédito. */
  | { readonly tipo: "anotar"; readonly estado: EstadoRecarga }
  /** Aprobada por un importe distinto: no se abona y alguien tiene que mirarla. */
  | { readonly tipo: "importe_distinto" }
  /** Revertida después de abonar: la deuda la decide una persona. */
  | { readonly tipo: "revertida_tras_abonar"; readonly estado: EstadoRecarga }
  | { readonly tipo: "nada" };

/**
 * Qué hacer con un estado que llega de la pasarela.
 *
 * Los eventos se repiten y pueden llegar desordenados, así que la decisión
 * depende de la orden guardada: `abonada` es lo que evita abonar dos veces.
 */
export function decidirTransaccion(
  orden: { readonly centavos: number; readonly moneda: string; readonly abonada: boolean },
  transaccion: { readonly estado: string; readonly centavos: number; readonly moneda: string },
): AccionTransaccion {
  switch (transaccion.estado) {
    case "APPROVED":
      if (orden.abonada) return { tipo: "nada" };
      if (transaccion.centavos !== orden.centavos || transaccion.moneda !== orden.moneda) {
        return { tipo: "importe_distinto" };
      }
      return { tipo: "abonar" };
    case "DECLINED":
      return orden.abonada ? { tipo: "nada" } : { tipo: "anotar", estado: "declined" };
    case "ERROR":
      return orden.abonada ? { tipo: "nada" } : { tipo: "anotar", estado: "error" };
    case "VOIDED":
      return orden.abonada
        ? { tipo: "revertida_tras_abonar", estado: "voided" }
        : { tipo: "anotar", estado: "voided" };
    default:
      return { tipo: "nada" };
  }
}

// ── Recarga automática ──────────────────────────────────────────────────────

/** Una orden sin respuesta tanto tiempo no bloquea la siguiente para siempre. */
export const ORDEN_PENDIENTE_CADUCA_MS = 60 * 60 * 1000;

export type MotivoApagado = "tarjeta_rechazada" | "tope_diario";

export type DecisionCobroAutomatico =
  | { readonly tipo: "cobrar" }
  | { readonly tipo: "esperar" }
  | { readonly tipo: "apagar"; readonly motivo: MotivoApagado };

/**
 * Si toca cargar la tarjeta. Decide sobre dinero del cliente sin que él esté
 * mirando, así que ante la duda espera.
 *
 * `recientes` son las órdenes automáticas de las últimas 24 horas, de la más
 * nueva a la más vieja.
 */
export function decidirCobroAutomatico(entrada: {
  disponible: number;
  recientes: readonly { readonly estado: EstadoRecarga; readonly creadaEn: Date }[];
  ahora: Date;
  config?: ConfigCobro;
}): DecisionCobroAutomatico {
  const config = entrada.config ?? CONFIG_COBRO_POR_DEFECTO;
  if (entrada.disponible >= config.umbralSaldoAcabado) return { tipo: "esperar" };

  const { recientes, ahora } = entrada;
  const edad = (fecha: Date) => ahora.getTime() - fecha.getTime();

  if (recientes.some((o) => o.estado === "pending" && edad(o.creadaEn) < ORDEN_PENDIENTE_CADUCA_MS)) {
    return { tipo: "esperar" };
  }

  let rechazos = 0;
  for (const orden of recientes) {
    if (orden.estado === "approved") break;
    if (orden.estado !== "pending") rechazos += 1;
  }
  if (rechazos >= config.rechazosParaApagar) return { tipo: "apagar", motivo: "tarjeta_rechazada" };

  const ultima = recientes[0];
  if (rechazos > 0 && ultima && edad(ultima.creadaEn) < config.esperaTrasRechazoMin * 60_000) return { tipo: "esperar" };

  const cobros = recientes.filter((o) => o.estado === "approved").length;
  if (cobros >= config.cobrosPorDia) return { tipo: "apagar", motivo: "tope_diario" };

  return { tipo: "cobrar" };
}

// ── TRM ─────────────────────────────────────────────────────────────────────

const FUENTE_TRM = "https://www.datos.gov.co/resource/32sa-8pi3.json";

/**
 * TRM del día, publicada por la Superintendencia Financiera en datos.gov.co.
 *
 * Wompi solo cobra en pesos y el crédito se vende en dólares. Si no hay TRM
 * fiable no se cotiza: un cambio inventado es cobrarle de más al cliente o
 * regalarle créditos.
 */
export async function obtenerTrm(opciones: { ahora?: Date; peticion?: RequestInit } = {}): Promise<number | null> {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(opciones.ahora ?? new Date());
  const parametros = new URLSearchParams({
    $select: "valor,vigenciadesde",
    $where: `vigenciadesde <= '${hoy}T00:00:00'`,
    $order: "vigenciadesde DESC",
    $limit: "1",
  });
  try {
    const respuesta = await fetch(`${FUENTE_TRM}?${parametros.toString()}`, {
      ...opciones.peticion,
      signal: AbortSignal.timeout(5_000),
    });
    if (!respuesta.ok) return null;
    const filas = (await respuesta.json()) as { valor?: string }[];
    const valor = Number(filas[0]?.valor);
    // Fuera de este rango el dato está mal publicado o mal leído.
    return Number.isFinite(valor) && valor > 1_000 && valor < 20_000 ? valor : null;
  } catch {
    return null;
  }
}
