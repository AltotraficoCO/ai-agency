import {
  ChartColumn,
  BookOpen,
  BotMessageSquare,
  Code2,
  House,
  Inbox,
  Megaphone,
  MessageCircle,
  PiggyBank,
  Receipt,
  Settings,
  Sparkles,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { DEPARTAMENTOS, type DepartamentoId } from "./departamentos";

/**
 * Rutas de la aplicación. Los enlaces del menú solo pueden apuntar a una de
 * estas: si una ruta cambia, TypeScript obliga a actualizarla en un único sitio.
 */
export const rutas = {
  inicio: "/",
  agentes: "/agentes",
  impacto: "/negocio/impacto",
  agentesWhatsapp: "/whatsapp/agentes",
  bandeja: "/bandeja",
  contactos: "/contactos",
  canales: "/ajustes/canales",
  conocimiento: "/conocimiento",
  analitica: "/analitica",
  marketing: "/departamento/marketing",
  desarrollo: "/departamento/desarrollo",
  financiero: "/departamento/financiero",
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
 * Un departamento de la empresa: un título y las pantallas de su área.
 *
 * Se pliega y se despliega. Mientras solo tenga una pantalla, el menú lo pinta
 * como un enlace directo —un acordeón de un solo hijo son dos clics para llegar
 * a lo mismo— y se convierte en desplegable solo cuando gana la segunda.
 */
export interface GrupoNav {
  id: DepartamentoId;
  etiqueta: string;
  icono: LucideIcon;
  destinos: readonly DestinoNav[];
}

export type EntradaNav = DestinoNav | GrupoNav;

export function esGrupoNav(entrada: EntradaNav): entrada is GrupoNav {
  return "destinos" in entrada;
}

const inicio: DestinoNav = { id: "inicio", etiqueta: "Inicio", href: rutas.inicio, icono: House };
const equipo: DestinoNav = {
  id: "agentes",
  etiqueta: "Tu equipo",
  href: rutas.agentes,
  icono: UsersRound,
};
const impacto: DestinoNav = {
  id: "impacto",
  etiqueta: "Impacto",
  href: rutas.impacto,
  icono: PiggyBank,
};

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

const agentesMarketing: DestinoNav = {
  id: "marketing",
  etiqueta: "Agentes de marketing",
  href: rutas.marketing,
  icono: Megaphone,
};
const agentesDesarrollo: DestinoNav = {
  id: "desarrollo",
  etiqueta: "Agentes de desarrollo",
  href: rutas.desarrollo,
  icono: Code2,
};
const agentesFinanciero: DestinoNav = {
  id: "financiero",
  etiqueta: "Agentes financieros",
  href: rutas.financiero,
  icono: Receipt,
};

/**
 * El menú, en el orden en que se lee.
 *
 * Arriba, lo que es de la empresa entera: dónde empiezas (Inicio), quién
 * trabaja para ti (Tu equipo) y qué te están ahorrando (Impacto). Impacto no
 * cuelga de ningún departamento a propósito: suma el trabajo de todos, y
 * meterlo en uno haría creer que solo mide ese.
 *
 * Debajo, los departamentos, que son el armazón para ir contratando: hoy
 * Comunicaciones tiene cinco pantallas y los demás una, mañana tendrán las
 * suyas sin tocar este archivo más que para añadir la línea.
 *
 * Canales no está aquí a propósito: WhatsApp se conecta una vez y luego no se
 * vuelve a tocar, así que vive en Ajustes.
 */
export const menuPrincipal: readonly EntradaNav[] = [
  inicio,
  equipo,
  impacto,
  {
    id: "comunicaciones",
    etiqueta: DEPARTAMENTOS.comunicaciones.etiqueta,
    icono: MessageCircle,
    destinos: [agentesWhatsapp, bandeja, contactos, conocimiento, analitica],
  },
  {
    id: "marketing",
    etiqueta: DEPARTAMENTOS.marketing.etiqueta,
    icono: Megaphone,
    destinos: [agentesMarketing],
  },
  {
    id: "desarrollo",
    etiqueta: DEPARTAMENTOS.desarrollo.etiqueta,
    icono: Code2,
    destinos: [agentesDesarrollo],
  },
  {
    id: "financiero",
    etiqueta: DEPARTAMENTOS.financiero.etiqueta,
    icono: Receipt,
    destinos: [agentesFinanciero],
  },
];

/** Los mismos destinos del menú, sin agrupar. */
export const destinosPrincipales: readonly DestinoNav[] = menuPrincipal.flatMap((entrada) =>
  esGrupoNav(entrada) ? entrada.destinos : [entrada],
);

/**
 * Un departamento con una sola pantalla se enseña como enlace directo.
 *
 * El enlace conserva el nombre y el icono del DEPARTAMENTO —es lo que la
 * persona busca en el menú— y apunta a su única pantalla. En cuanto el
 * departamento tenga dos, vuelve a ser un desplegable sin tocar nada.
 */
export function entradaDeGrupo(grupo: GrupoNav): DestinoNav | null {
  const unico = grupo.destinos.length === 1 ? grupo.destinos[0] : undefined;
  return unico ? { ...unico, etiqueta: grupo.etiqueta, icono: grupo.icono } : null;
}

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

/** La pantalla de agentes de cada departamento, para enlazar desde fuera del menú. */
export const rutaDeDepartamento: Readonly<Record<DepartamentoId, Ruta>> = {
  comunicaciones: rutas.agentesWhatsapp,
  marketing: rutas.marketing,
  desarrollo: rutas.desarrollo,
  financiero: rutas.financiero,
  otros: rutas.agentes,
};

export type EstadoCanal = "conectado" | "revisar" | "caido";

export const etiquetaEstadoCanal: Record<EstadoCanal, string> = {
  conectado: "Todos los canales conectados",
  revisar: "Un canal necesita revisión",
  caido: "Un canal está caído",
};
