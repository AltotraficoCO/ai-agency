import {
  ChartColumn,
  BookOpen,
  Bot,
  BotMessageSquare,
  BriefcaseBusiness,
  Inbox,
  House,
  MessageCircle,
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
  agentesWhatsapp: "/whatsapp/agentes",
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
 * Un módulo del producto: un título y sus destinos, siempre desplegados.
 *
 * No es un acordeón. Agrupa para que se entienda qué es de qué —la Bandeja y
 * los Contactos son de WhatsApp—, no para esconder nada detrás de un clic.
 */
export interface GrupoNav {
  id: string;
  etiqueta: string;
  icono: LucideIcon;
  destinos: readonly DestinoNav[];
}

export type EntradaNav = DestinoNav | GrupoNav;

export function esGrupoNav(entrada: EntradaNav): entrada is GrupoNav {
  return "destinos" in entrada;
}

const inicio: DestinoNav = { id: "inicio", etiqueta: "Inicio", href: rutas.inicio, icono: House };
const agentesWhatsapp: DestinoNav = {
  id: "agentesWhatsapp",
  etiqueta: "Agentes de WhatsApp",
  href: rutas.agentesWhatsapp,
  icono: BotMessageSquare,
};
const bandeja: DestinoNav = {
  id: "bandeja",
  etiqueta: "Bandeja",
  href: rutas.bandeja,
  icono: Inbox,
  indicador: "contador",
};
const contactos: DestinoNav = { id: "contactos", etiqueta: "Contactos", href: rutas.contactos, icono: Users };
const conocimiento: DestinoNav = {
  id: "conocimiento",
  etiqueta: "Conocimiento",
  href: rutas.conocimiento,
  icono: BookOpen,
};
const analitica: DestinoNav = {
  id: "analitica",
  etiqueta: "Analítica",
  href: rutas.analitica,
  icono: ChartColumn,
};
const agentesNegocio: DestinoNav = {
  id: "agentes",
  etiqueta: "Agentes del negocio",
  href: rutas.agentes,
  icono: Bot,
};

/**
 * El menú, en el orden en que se lee.
 *
 * Dos módulos que no se mezclan. WhatsApp es la atención a clientes: los
 * agentes que contestan (los crea la persona con Strap), la bandeja,
 * los contactos, lo que saben y cómo les va. Negocio son los agentes que
 * trabajan por encargo para la empresa, como el Webmaster o Marketing.
 *
 * Canales no está aquí a propósito: WhatsApp se conecta una vez y luego no se
 * vuelve a tocar, así que vive en Ajustes.
 */
export const menuPrincipal: readonly EntradaNav[] = [
  inicio,
  {
    id: "whatsapp",
    etiqueta: "WhatsApp",
    icono: MessageCircle,
    destinos: [agentesWhatsapp, bandeja, contactos, conocimiento, analitica],
  },
  { id: "negocio", etiqueta: "Negocio", icono: BriefcaseBusiness, destinos: [agentesNegocio] },
];

/** Los mismos destinos del menú, sin agrupar. */
export const destinosPrincipales: readonly DestinoNav[] = menuPrincipal.flatMap((entrada) =>
  esGrupoNav(entrada) ? entrada.destinos : [entrada],
);

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

/** Todo lo que el menú puede marcar como activo. */
export const todosLosDestinos: readonly DestinoNav[] = [
  ...destinosPrincipales,
  destinoContratar,
  destinoAjustes,
];

export type EstadoCanal = "conectado" | "revisar" | "caido";

export const etiquetaEstadoCanal: Record<EstadoCanal, string> = {
  conectado: "Todos los canales conectados",
  revisar: "Un canal necesita revisión",
  caido: "Un canal está caído",
};
