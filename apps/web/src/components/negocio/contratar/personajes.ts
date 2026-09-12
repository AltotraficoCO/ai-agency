/**
 * La cara de cada agente del catálogo y el dibujo de cada capacidad.
 *
 * **La imagen es un DATO**, no código: viene de `catalog_agents.avatar_url`
 * (migración 0037) y, si el cliente la cambió, de su propio agente. Antes vivía
 * en un diccionario aquí dentro que solo conocía a webmaster y marketing, así
 * que cada agente nuevo nacía con el robot genérico hasta que alguien se
 * acordaba de añadir su línea. Ese diccionario ya no decide la cara.
 *
 * Lo que sí se queda aquí es el HALO: el degradado que va detrás del personaje,
 * que es decisión visual y depende del color de cada pieza de plastilina.
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
  Gauge,
  Globe,
  Image as ImagenIcono,
  LayoutTemplate,
  MessageCircle,
  PenLine,
  Puzzle,
  Receipt,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { IconoCapacidad } from "@/lib/negocio/catalogo";

export type Personaje = {
  readonly imagen?: string;
  /** Degradado radial detrás del personaje. */
  readonly halo: string;
};

/** El color de fondo de cada personaje. Solo el halo: la imagen es dato. */
const HALOS: Readonly<Record<string, string>> = {
  webmaster: "radial-gradient(circle, rgba(45,212,191,0.30) 0%, rgba(45,212,191,0) 70%)",
  marketing: "radial-gradient(circle, rgba(251,113,133,0.30) 0%, rgba(251,113,133,0) 70%)",
  disenador: "radial-gradient(circle, rgba(168,85,247,0.30) 0%, rgba(168,85,247,0) 70%)",
  velocista: "radial-gradient(circle, rgba(56,189,248,0.30) 0%, rgba(56,189,248,0) 70%)",
  administrativo: "radial-gradient(circle, rgba(250,204,21,0.28) 0%, rgba(250,204,21,0) 70%)",
  reportes: "radial-gradient(circle, rgba(52,211,153,0.28) 0%, rgba(52,211,153,0) 70%)",
};

const HALO_POR_DEFECTO = "radial-gradient(circle, rgba(57,255,20,0.22) 0%, rgba(57,255,20,0) 70%)";

/**
 * @param imagen la que trae el dato: la del catálogo o, si el cliente la
 *   cambió, la de su agente. Sin ella se pinta el robot, que es lo honesto:
 *   significa que a ese agente todavía no le han puesto cara.
 */
export function personajeDe(slug: string, imagen?: string | null): Personaje {
  const halo = HALOS[slug] ?? HALO_POR_DEFECTO;
  return imagen ? { imagen, halo } : { halo };
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
  imagen: ImagenIcono,
  velocidad: Gauge,
  factura: Receipt,
  dinero: Wallet,
};

/** El robot de los agentes que todavía no tienen cara. */
export const IconoSinPersonaje = Bot;
