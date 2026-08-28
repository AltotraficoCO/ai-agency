/**
 * Cuándo se da por cerrada una conversación.
 *
 * El cierre es el disparo del análisis, así que la regla vive aquí y no
 * repartida por el motor: cuatro motivos, uno solo gana, y el orden importa
 * (un traspaso a humano cierra aunque además haya inactividad).
 */
import type { MotivoCierre } from "./tipos.js";

/** Media hora sin una palabra es una conversación terminada, no una pausa. */
export const INACTIVIDAD_MS = 30 * 60 * 1000;

/** Techo de turnos por conversación. Sin techo, un bucle cuesta dinero real. */
export const LIMITE_DE_TURNOS = 60;

export type EstadoDeCierre = {
  readonly ultimoMensajeEl: Date;
  readonly ahora: Date;
  /** `human` significa que una persona del equipo tomó la conversación. */
  readonly handover?: "bot" | "human" | "paused";
  readonly turnos: number;
  readonly cerradaExplicitamente?: boolean;
  readonly inactividadMs?: number;
  readonly limiteDeTurnos?: number;
};

export function motivoDeCierre(e: EstadoDeCierre): MotivoCierre | null {
  if (e.cerradaExplicitamente) return "explicito";
  if (e.handover === "human") return "traspaso";
  if (e.turnos >= (e.limiteDeTurnos ?? LIMITE_DE_TURNOS)) return "limite_turnos";
  const silencio = e.ahora.getTime() - e.ultimoMensajeEl.getTime();
  if (silencio >= (e.inactividadMs ?? INACTIVIDAD_MS)) return "inactividad";
  return null;
}
