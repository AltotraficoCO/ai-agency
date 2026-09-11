import {
  ChartColumn,
  BookOpen,
  Bot,
  Inbox,
  House,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Rutas de la aplicación. Los enlaces del menú solo pueden apuntar a una de
 * estas: si una ruta cambia, TypeScript obliga a actualizarla en un único sitio.
 */
export const rutas = {
  inicio: "/",
  bandeja: "/bandeja",
  agentes: "/agentes",
  contactos: "/contactos",
  canales: "/ajustes/canales",
  conocimiento: "/conocimiento",
  analitica: "/analitica",
  contratar: "/contratar",
  ajustes: "/ajustes",
} as const;

export type Ruta = (typeof rutas)[keyof typeof rutas];

export type IndicadorNav = "contador" | "estado";

export interface DestinoNav {
  id: keyof typeof rutas;
  etiqueta: string;
  href: Ruta;
  icono: LucideIcon;
  /** `contador` muestra un número; `estado` muestra un punto de salud del canal. */
  indicador?: IndicadorNav;
  /** Destaca la acción de crear; va después del separador. */
  destacado?: boolean;
}

/**
 * Los seis destinos están siempre visibles: sin acordeones, sin submenús.
 *
 * Canales no está aquí a propósito: WhatsApp se conecta una vez y luego no se
 * vuelve a tocar, así que vive en Ajustes junto a la cuenta y la facturación en
 * vez de ocupar un sitio en el menú de todos los días.
 */
export const destinosPrincipales: readonly DestinoNav[] = [
  { id: "inicio", etiqueta: "Inicio", href: rutas.inicio, icono: House },
  { id: "bandeja", etiqueta: "Bandeja", href: rutas.bandeja, icono: Inbox, indicador: "contador" },
  { id: "agentes", etiqueta: "Agentes", href: rutas.agentes, icono: Bot },
  { id: "contactos", etiqueta: "Contactos", href: rutas.contactos, icono: Users },
  { id: "conocimiento", etiqueta: "Conocimiento", href: rutas.conocimiento, icono: BookOpen },
  { id: "analitica", etiqueta: "Analítica", href: rutas.analitica, icono: ChartColumn },
];

export const destinoContratar: DestinoNav = {
  id: "contratar",
  etiqueta: "Contratar agente",
  href: rutas.contratar,
  icono: Sparkles,
  destacado: true,
};

export const destinoAjustes: DestinoNav = {
  id: "ajustes",
  etiqueta: "Ajustes",
  href: rutas.ajustes,
  icono: Settings,
};

export type EstadoCanal = "conectado" | "revisar" | "caido";

export const etiquetaEstadoCanal: Record<EstadoCanal, string> = {
  conectado: "Todos los canales conectados",
  revisar: "Un canal necesita revisión",
  caido: "Un canal está caído",
};
