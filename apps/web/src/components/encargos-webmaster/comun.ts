/**
 * Lo que comparten las piezas de la pantalla de encargos: las etiquetas de cada
 * estado, las acciones sobre un encargo y la forma de lo que llega del servidor.
 */
import type * as React from "react";
import type { EncargoVista } from "@/lib/encargos/encargos";
import type { Resultado } from "@/lib/negocio/acciones";
import type { TonoHistorial } from "@/components/conversacion/panel-historial";

export const EN_CURSO = new Set<EncargoVista["estado"]>(["queued", "running"]);

export const ETIQUETAS: Record<EncargoVista["estado"], { texto: string; tono: TonoHistorial }> = {
  queued: { texto: "En cola", tono: "neutral" },
  running: { texto: "Trabajando", tono: "ia" },
  esperando_aprobacion: { texto: "Necesita tu respuesta", tono: "aviso" },
  done: { texto: "Hecho", tono: "exito" },
  failed: { texto: "Falló", tono: "error" },
  cancelled: { texto: "Cancelado", tono: "neutral" },
};

export type Acciones = {
  decidir: (aprobacionId: string, aprobada: boolean) => Promise<Resultado>;
  responder: (aprobacionId: string, respuesta: string) => Promise<Resultado>;
  eliminar: (taskId: string) => Promise<Resultado>;
  parar: (taskId: string) => Promise<Resultado>;
};

/**
 * Un aviso de la vigilancia: lo escribe el Webmaster solo, sin que nadie se lo
 * pida. El tipo se declara aquí, y no se importa de `lib/sitio/avisos-sitio`,
 * porque ese módulo es de servidor y esta pantalla corre en el navegador.
 */
export type AvisoDelSitio = {
  id: string;
  severidad: "grave" | "aviso" | "bueno";
  titulo: string;
  cuerpo: string;
  propuesta: string | null;
};

/** Lo que tiene conectado: el sitio del Webmaster, las cuentas de Marketing. */
export type SitioConectado = { nombre: string; url: string };

/** Lite o Max, para cambiarlo sin salir de la conversación. */
export type ModoAgente = { agentId: string; actual: "lite" | "max"; planDePago: boolean };

/** El trabajo que el agente repite solo, y cuántos hay. */
export type TrabajoProgramado = { nodo: React.ReactNode; cuantos: number };
