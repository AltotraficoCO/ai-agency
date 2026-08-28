/**
 * Canario: la versión nueva atiende al 10% durante 24 h y se compara con la
 * estable. Revertir es un `update` de `active_version_id`, un clic.
 *
 * El reparto es DETERMINISTA por conversación: la misma conversación cae
 * siempre del mismo lado. Si se sorteara por turno, un cliente hablaría con
 * dos versiones distintas dentro del mismo hilo.
 */
export const PORCENTAJE_CANARIO = 10;
export const HORAS_DE_CANARIO = 24;
/** Con menos conversaciones por lado, la diferencia es azar. */
export const MUESTRA_MINIMA = 30;
/** Caída de puntuación media tolerada antes de revertir. */
export const CAIDA_MAXIMA = 5;
/** Subida de tasa de traspaso tolerada, en puntos porcentuales. */
export const SUBIDA_TRASPASO_MAXIMA = 0.05;

function huella(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function enCanario(conversationId: string, porcentaje: number = PORCENTAJE_CANARIO): boolean {
  if (porcentaje <= 0) return false;
  if (porcentaje >= 100) return true;
  return huella(conversationId) % 100 < porcentaje;
}

/** Qué versión atiende esta conversación mientras el canario está abierto. */
export function versionParaConversacion(input: {
  readonly conversationId: string;
  readonly versionEstableId: string;
  readonly versionCanariaId?: string;
  readonly porcentaje?: number;
}): string {
  if (!input.versionCanariaId) return input.versionEstableId;
  return enCanario(input.conversationId, input.porcentaje ?? PORCENTAJE_CANARIO)
    ? input.versionCanariaId
    : input.versionEstableId;
}

export type MetricasDeVersion = {
  readonly versionId: string;
  readonly muestras: number;
  /** Media de `objetivo_score` del análisis, 0–100. */
  readonly puntuacionMedia: number;
  /** Proporción 0–1 de conversaciones que acabaron en manos de una persona. */
  readonly tasaTraspaso: number;
};

export type DecisionDeCanario = {
  readonly recomendacion: "promover" | "revertir" | "esperar";
  readonly motivo: string;
  readonly deltaPuntuacion: number;
  readonly deltaTraspaso: number;
};

export function compararCanario(input: {
  readonly estable: MetricasDeVersion;
  readonly canario: MetricasDeVersion;
  readonly horasTranscurridas: number;
  readonly muestraMinima?: number;
  readonly horasMinimas?: number;
  readonly caidaMaxima?: number;
  readonly subidaTraspasoMaxima?: number;
}): DecisionDeCanario {
  const deltaPuntuacion = redondear(input.canario.puntuacionMedia - input.estable.puntuacionMedia);
  const deltaTraspaso = redondear3(input.canario.tasaTraspaso - input.estable.tasaTraspaso);
  const caida = input.caidaMaxima ?? CAIDA_MAXIMA;
  const subida = input.subidaTraspasoMaxima ?? SUBIDA_TRASPASO_MAXIMA;

  // Revertir se decide con la evidencia que haya: esperar 24 h a que empeore
  // más no ayuda a nadie. Promover sí exige la ventana completa.
  if (deltaPuntuacion <= -caida) {
    return { recomendacion: "revertir", motivo: `La puntuación media cae ${Math.abs(deltaPuntuacion)} puntos frente a la estable.`, deltaPuntuacion, deltaTraspaso };
  }
  if (deltaTraspaso >= subida) {
    return {
      recomendacion: "revertir",
      motivo: `La tasa de traspaso sube ${(deltaTraspaso * 100).toFixed(1)} puntos frente a la estable.`,
      deltaPuntuacion,
      deltaTraspaso,
    };
  }

  const muestra = input.muestraMinima ?? MUESTRA_MINIMA;
  if (input.canario.muestras < muestra || input.estable.muestras < muestra) {
    return { recomendacion: "esperar", motivo: `Muestra insuficiente: hacen falta ${muestra} conversaciones por versión.`, deltaPuntuacion, deltaTraspaso };
  }
  if (input.horasTranscurridas < (input.horasMinimas ?? HORAS_DE_CANARIO)) {
    return { recomendacion: "esperar", motivo: `Faltan horas para cerrar la ventana de ${input.horasMinimas ?? HORAS_DE_CANARIO} h.`, deltaPuntuacion, deltaTraspaso };
  }
  return { recomendacion: "promover", motivo: "No hay caída de puntuación ni más traspasos que la estable.", deltaPuntuacion, deltaTraspaso };
}

/** Mover el puntero de versión activa. Promover y revertir son lo mismo. */
export interface VersionesPort {
  activar(input: { workspaceId: string; agentId: string; versionId: string }): Promise<void>;
}

export async function revertir(
  versiones: VersionesPort,
  input: { workspaceId: string; agentId: string; versionEstableId: string },
): Promise<void> {
  await versiones.activar({ workspaceId: input.workspaceId, agentId: input.agentId, versionId: input.versionEstableId });
}

function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}
function redondear3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
