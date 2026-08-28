/**
 * Agotamiento de saldo y topes de gasto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE NEGOCIA
 * ────────────────────────────────────────────────────────────────────────────
 * Quedarse sin créditos DETIENE AL BOT, NO AL NEGOCIO. Cuando el saldo llega a
 * cero el agente deja de responder solo, pero la bandeja sigue viva: los
 * mensajes del cliente siguen entrando, el equipo los sigue viendo y sigue
 * pudiendo contestar a mano. Por eso `bandejaOperativa` es `true` en todas las
 * ramas de este archivo, sin excepción.
 *
 * Bloquear la bandeja por un impago convierte un problema de facturación en una
 * caída de atención al cliente. El cliente pierde ventas, nos culpa a nosotros,
 * y aun así no paga más rápido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY TOPES ADEMÁS DEL SALDO
 * ────────────────────────────────────────────────────────────────────────────
 * Un bucle entre dos automatismos puede quemar el saldo de un mes en cinco
 * minutos. El saldo solo avisa cuando ya se gastó; los topes por día y por
 * conversación paran el bucle mientras todavía queda dinero.
 *
 * Módulo puro: decide, no ejecuta. Quien apaga el bot es el motor, leyendo
 * esta decisión y anotando `agent_runs.skip_reason`.
 */

/** Topes configurables por el cliente. `null` = sin tope. */
export type LimitesGasto = {
  /** Créditos como máximo en un día natural del espacio. */
  readonly diario: number | null;
  /** Créditos como máximo en una sola conversación. */
  readonly porConversacion: number | null;
  /**
   * `dura` (por defecto): al llegar a cero el bot para.
   * `blanda`: se permite seguir con saldo negativo y se factura después. Solo
   * para clientes con contrato y método de pago verificado.
   */
  readonly parada: "dura" | "blanda";
};

export const LIMITES_POR_DEFECTO: LimitesGasto = {
  diario: null,
  porConversacion: 2_000,
  parada: "dura",
};

/** Motivo por el que el bot no responde. Coincide con `agent_runs.skip_reason`. */
export type MotivoParada = "no_credits" | "tope_diario" | "tope_conversacion";

export type DecisionEjecucion = {
  readonly permitido: boolean;
  readonly motivo: MotivoParada | null;
  /**
   * SIEMPRE true. Está en el tipo, y no implícito, para que cualquiera que
   * añada una rama nueva tenga que escribirlo y se pregunte por qué.
   */
  readonly bandejaOperativa: true;
  /** Texto que ve el equipo en la conversación. */
  readonly explicacion: string | null;
};

const PERMITIDO: DecisionEjecucion = {
  permitido: true,
  motivo: null,
  bandejaOperativa: true,
  explicacion: null,
};

export function decidirEjecucion(entrada: {
  /** Saldo disponible: incluido + comprado − reservado. */
  saldoDisponible: number;
  /** Coste estimado del turno, en créditos. */
  costeEstimado: number;
  gastadoHoy: number;
  gastadoEnConversacion: number;
  limites?: LimitesGasto;
}): DecisionEjecucion {
  const limites = entrada.limites ?? LIMITES_POR_DEFECTO;
  const coste = Math.max(0, entrada.costeEstimado);

  if (limites.porConversacion !== null && entrada.gastadoEnConversacion + coste > limites.porConversacion) {
    return {
      permitido: false,
      motivo: "tope_conversacion",
      bandejaOperativa: true,
      explicacion:
        `Esta conversación alcanzó el tope de ${limites.porConversacion} créditos que fijaste. ` +
        "El agente dejó de responder aquí; podéis seguir a mano desde la bandeja.",
    };
  }

  if (limites.diario !== null && entrada.gastadoHoy + coste > limites.diario) {
    return {
      permitido: false,
      motivo: "tope_diario",
      bandejaOperativa: true,
      explicacion:
        `Hoy se alcanzó el tope diario de ${limites.diario} créditos. ` +
        "El agente vuelve solo mañana; mientras tanto la bandeja sigue abierta.",
    };
  }

  if (limites.parada === "dura" && entrada.saldoDisponible < coste) {
    return {
      permitido: false,
      motivo: "no_credits",
      bandejaOperativa: true,
      explicacion:
        "Te quedaste sin créditos: el agente dejó de responder automáticamente. " +
        "Tu bandeja, tus contactos y tu historial siguen funcionando y tu equipo puede contestar a mano.",
    };
  }

  return PERMITIDO;
}

/** Lee los topes de `workspaces.settings`, tolerando cualquier forma guardada. */
export function limitesDesdeAjustes(settings: unknown): LimitesGasto {
  const raiz = esObjeto(settings) ? settings : {};
  const nodo = esObjeto(raiz["limites_credito"]) ? (raiz["limites_credito"] as Record<string, unknown>) : {};
  const parada = nodo["parada"] === "blanda" ? "blanda" : "dura";
  return {
    diario: enteroPositivoONulo(nodo["diario"]),
    porConversacion:
      nodo["por_conversacion"] === undefined
        ? LIMITES_POR_DEFECTO.porConversacion
        : enteroPositivoONulo(nodo["por_conversacion"]),
    parada,
  };
}

/** Forma en la que se guardan de vuelta en `workspaces.settings`. */
export function limitesAAjustes(limites: LimitesGasto): Record<string, unknown> {
  return {
    limites_credito: {
      diario: limites.diario,
      por_conversacion: limites.porConversacion,
      parada: limites.parada,
    },
  };
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function enteroPositivoONulo(valor: unknown): number | null {
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}
