/**
 * Palabras y fechas de la pantalla de Conocimiento.
 *
 * Módulo puro: lo usan tanto las páginas de servidor como los paneles de
 * cliente, así que no importa nada de React.
 */
import type { EstadoFuente, ResumenCerebro } from "@/lib/conocimiento/tipos";

const FECHA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });

/** «hace 5 min», «hace 3 días», «12 sept.». */
export function fechaRelativa(iso: string): string {
  const instante = new Date(iso);
  const segundos = (Date.now() - instante.getTime()) / 1000;
  if (!Number.isFinite(segundos)) return "";
  if (segundos < 60) return "hace un momento";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return dias === 1 ? "ayer" : `hace ${dias} días`;
  return FECHA.format(instante);
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString("es-CO")} ${n === 1 ? uno : varios}`;
}

export type TonoEstado = "neutral" | "ia" | "exito" | "aviso" | "error";

export const ESTADO_FUENTE: Readonly<Record<EstadoFuente, { texto: string; tono: TonoEstado }>> = {
  pendiente: { texto: "En cola", tono: "neutral" },
  aprendiendo: { texto: "Aprendiendo", tono: "ia" },
  lista: { texto: "Lista", tono: "exito" },
  revisar: { texto: "Revisar", tono: "aviso" },
  error: { texto: "Error", tono: "error" },
};

/** El estado de una base entera, resumido en una palabra. */
export function estadoDeBase(base: Pick<ResumenCerebro, "aprendiendo" | "conProblemas" | "fuentes">): {
  texto: string;
  tono: TonoEstado;
  animado: boolean;
} {
  if (base.aprendiendo > 0) return { texto: "Aprendiendo", tono: "ia", animado: true };
  if (base.conProblemas > 0) return { texto: "Con problemas", tono: "aviso", animado: false };
  if (base.fuentes === 0) return { texto: "Vacía", tono: "neutral", animado: false };
  return { texto: "Lista", tono: "exito", animado: false };
}
