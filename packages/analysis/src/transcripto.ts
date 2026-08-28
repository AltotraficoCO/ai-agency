/**
 * El transcript, en texto plano y estable.
 *
 * El modelo ve exactamente esto. Que sea determinista importa más de lo que
 * parece: es lo que permite comprobar que el juez no cambia de opinión ante la
 * misma conversación.
 */
import type { MensajeTranscrito, RolTranscrito, Transcripto } from "./tipos.js";

const ETIQUETA: Record<RolTranscrito, string> = {
  contacto: "Cliente",
  agente: "Agente",
  humano: "Equipo",
  sistema: "Sistema",
};

/** Marcas que delimitan el transcript dentro del texto que ve el modelo. */
export const MARCA_INICIO = "--- TRANSCRIPT ---";
export const MARCA_FIN = "--- FIN DEL TRANSCRIPT ---";

/**
 * Recupera solo el transcript de una entrada ya montada. Lo usa el modelo de
 * ensayo: sin esto sus heurísticas leerían también las instrucciones y
 * "agendar una visita" en el objetivo contaría como visita agendada.
 */
export function extraerTranscripto(entrada: string): string {
  const i = entrada.indexOf(MARCA_INICIO);
  const j = entrada.indexOf(MARCA_FIN);
  if (i < 0 || j < 0 || j < i) return entrada;
  return entrada.slice(i + MARCA_INICIO.length, j).trim();
}

export function formatearTranscripto(mensajes: readonly MensajeTranscrito[]): string {
  return mensajes
    .filter((m) => m.texto.trim().length > 0)
    .map((m) => `${ETIQUETA[m.rol]}: ${m.texto.trim()}`)
    .join("\n");
}

/** Turnos del contacto. Es la medida que usa el límite de turnos. */
export function contarTurnos(t: Transcripto): number {
  return t.mensajes.filter((m) => m.rol === "contacto").length;
}
