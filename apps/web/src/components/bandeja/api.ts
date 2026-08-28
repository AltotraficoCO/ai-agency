"use client";

/**
 * El cliente HTTP de la bandeja.
 *
 * Un único sitio que sabe cómo se habla con `/api/bandeja`. Todas las llamadas
 * devuelven el error en español que mandó el servidor: la interfaz nunca
 * inventa un mensaje de error propio cuando el servidor ya escribió uno.
 */
import type { Catalogos, ConversacionResumen, Filtros, Hilo, Restriccion } from "@/lib/bandeja/tipos";

export type Contadores = Record<"todas" | "mias" | "sin-asignar" | "sin-leer" | "urgentes", number>;

export class ErrorDeBandeja extends Error {
  constructor(
    mensaje: string,
    readonly restriccion?: Restriccion,
  ) {
    super(mensaje);
    this.name = "ErrorDeBandeja";
  }
}

function parametrosDe(filtros: Filtros): string {
  const p = new URLSearchParams();
  p.set("pestana", filtros.pestana);
  p.set("estado", filtros.estado);
  if (filtros.busqueda.trim()) p.set("busqueda", filtros.busqueda.trim());
  if (filtros.canalId) p.set("canal", filtros.canalId);
  if (filtros.asignadoId) p.set("asignado", filtros.asignadoId);
  if (filtros.agenteId) p.set("agente", filtros.agenteId);
  if (filtros.etiquetaId) p.set("etiqueta", filtros.etiquetaId);
  if (filtros.desde) p.set("desde", filtros.desde);
  if (filtros.hasta) p.set("hasta", filtros.hasta);
  if (filtros.soloUrgentes) p.set("urgentes", "1");
  return p.toString();
}

async function pedir<T>(url: string, opciones?: RequestInit): Promise<T> {
  const respuesta = await fetch(url, {
    cache: "no-store",
    ...opciones,
    headers: { "content-type": "application/json", ...(opciones?.headers ?? {}) },
  });
  const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
    mensaje?: string;
    restriccion?: Restriccion;
  };
  if (!respuesta.ok) {
    throw new ErrorDeBandeja(
      datos.mensaje ?? datos.error ?? "No pudimos completar la acción.",
      datos.restriccion,
    );
  }
  return datos as T;
}

export async function traerLista(
  filtros: Filtros,
  señal?: AbortSignal,
): Promise<{ conversaciones: ConversacionResumen[]; contadores: Contadores }> {
  return pedir(`/api/bandeja/conversaciones?${parametrosDe(filtros)}`, señal ? { signal: señal } : {});
}

export async function traerHilo(id: string, señal?: AbortSignal): Promise<Hilo> {
  const { hilo } = await pedir<{ hilo: Hilo }>(
    `/api/bandeja/conversaciones/${id}`,
    señal ? { signal: señal } : {},
  );
  return hilo;
}

export async function traerCatalogos(): Promise<Catalogos> {
  const { catalogos } = await pedir<{ catalogos: Catalogos }>("/api/bandeja/catalogos");
  return catalogos;
}

export type Accion =
  | { tipo: "tomar-control" }
  | { tipo: "devolver-control"; resumen?: string }
  | { tipo: "pausar-ia"; minutos: number }
  | { tipo: "solicitar-control" }
  | { tipo: "asignar"; usuarioId: string | null }
  | { tipo: "posponer"; hasta: string | null }
  | { tipo: "cerrar" }
  | { tipo: "reabrir" }
  | { tipo: "marcar-leida" }
  | { tipo: "etiquetar"; etiquetaId: string; poner: boolean }
  | { tipo: "nota"; texto: string; menciones: string[] }
  | { tipo: "resumir" }
  | { tipo: "usar-respuesta"; respuestaId: string };

export async function ejecutar(
  conversacionId: string,
  accion: Accion,
): Promise<{ ok: boolean; datos?: Record<string, unknown> }> {
  return pedir(`/api/bandeja/conversaciones/${conversacionId}/acciones`, {
    method: "POST",
    body: JSON.stringify(accion),
  });
}

/** Escribir al cliente. Su propia ruta, a propósito: ver `acciones.ts`. */
export async function enviarMensaje(conversacionId: string, texto: string): Promise<void> {
  await pedir(`/api/bandeja/conversaciones/${conversacionId}/mensajes`, {
    method: "POST",
    body: JSON.stringify({ texto }),
  });
}

export async function crearEtiqueta(nombre: string, color: string) {
  const { etiqueta } = await pedir<{ etiqueta: { id: string; nombre: string; color: string } }>(
    "/api/bandeja/catalogos",
    { method: "POST", body: JSON.stringify({ tipo: "etiqueta", nombre, color }) },
  );
  return etiqueta;
}

export async function crearRespuestaRapida(atajo: string, titulo: string, cuerpo: string) {
  const { respuesta } = await pedir<{
    respuesta: { id: string; atajo: string; titulo: string; cuerpo: string };
  }>("/api/bandeja/catalogos", {
    method: "POST",
    body: JSON.stringify({ tipo: "respuesta", atajo, titulo, cuerpo }),
  });
  return respuesta;
}

export async function sembrarEjemplos(): Promise<void> {
  await pedir("/api/bandeja/semilla", { method: "POST" });
}
