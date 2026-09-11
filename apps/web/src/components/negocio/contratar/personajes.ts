/**
 * La cara de cada agente del catálogo y el dibujo de cada capacidad.
 *
 * Es dato puro, sin `"use client"`: lo usan tanto el catálogo, que se pinta en
 * el servidor, como el asistente, que vive en el cliente.
 */
import {
  BookOpen,
  Bot,
  CalendarClock,
  ChartColumn,
  DatabaseBackup,
  Globe,
  LayoutTemplate,
  MessageCircle,
  PenLine,
  Puzzle,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { IconoCapacidad } from "@/lib/negocio/catalogo";

export type Personaje = {
  readonly imagen?: string;
  /** Degradado radial detrás del personaje. */
  readonly halo: string;
};

const PERSONAJES: Readonly<Record<string, Personaje>> = {
  webmaster: {
    imagen: "/agentes/webmaster.webp",
    halo: "radial-gradient(circle, rgba(57,255,20,0.26) 0%, rgba(57,255,20,0) 70%)",
  },
  recepcionista: {
    imagen: "/agentes/recepcionista.webp",
    halo: "radial-gradient(circle, rgba(0,128,255,0.30) 0%, rgba(0,128,255,0) 70%)",
  },
  marketing: {
    imagen: "/agentes/marketing.webp",
    halo: "radial-gradient(circle, rgba(34,211,238,0.28) 0%, rgba(34,211,238,0) 70%)",
  },
};

const SIN_PERSONAJE: Personaje = {
  halo: "radial-gradient(circle, rgba(57,255,20,0.22) 0%, rgba(57,255,20,0) 70%)",
};

export function personajeDe(slug: string): Personaje {
  return PERSONAJES[slug] ?? SIN_PERSONAJE;
}

export const ICONO_CAPACIDAD: Readonly<Record<IconoCapacidad, LucideIcon>> = {
  web: Globe,
  plantilla: LayoutTemplate,
  plugin: Puzzle,
  copia: DatabaseBackup,
  aprobacion: ShieldCheck,
  mensaje: MessageCircle,
  conocimiento: BookOpen,
  contacto: UserRound,
  agenda: CalendarClock,
  humano: Users,
  redactar: PenLine,
  segmentar: Users,
  medir: ChartColumn,
};

/** El robot de los agentes que todavía no tienen personaje. */
export const IconoSinPersonaje = Bot;
