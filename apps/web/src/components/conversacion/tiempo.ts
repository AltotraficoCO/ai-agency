/**
 * Fechas legibles para el historial y el registro de trabajo.
 *
 * Todo en español y en lo que una persona diría en voz alta: «hace 5 min»,
 * «ayer», «12 sept». Nada de ISO ni de segundos exactos.
 */

const HORA = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });
const DIA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });

export type GrupoFecha = "Hoy" | "Ayer" | "Esta semana" | "Antes";

export const ORDEN_GRUPOS: readonly GrupoFecha[] = ["Hoy", "Ayer", "Esta semana", "Antes"];

export function horaCorta(iso: string): string {
  return HORA.format(new Date(iso));
}

export function haceRelativo(iso: string, ahora: number = Date.now()): string {
  const segundos = (ahora - new Date(iso).getTime()) / 1000;
  if (segundos < 60) return "ahora";
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`;
  if (segundos < 86_400) return `hace ${Math.floor(segundos / 3600)} h`;
  if (segundos < 172_800) return "ayer";
  return DIA.format(new Date(iso));
}

export function grupoDeFecha(iso: string, ahora: Date = new Date()): GrupoFecha {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const momento = new Date(iso).getTime();
  const dia = 86_400_000;
  if (momento >= hoy) return "Hoy";
  if (momento >= hoy - dia) return "Ayer";
  if (momento >= hoy - 6 * dia) return "Esta semana";
  return "Antes";
}

/** «40 s», «3 min», «1 h 5 min». */
export function duracionLegible(desde: string, hasta: string): string {
  const segundos = Math.max(0, (new Date(hasta).getTime() - new Date(desde).getTime()) / 1000);
  if (segundos < 60) return `${Math.max(1, Math.round(segundos))} s`;
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
  return `${Math.floor(segundos / 3600)} h ${Math.round((segundos % 3600) / 60)} min`;
}
