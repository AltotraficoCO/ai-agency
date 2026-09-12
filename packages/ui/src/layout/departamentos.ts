/**
 * Los departamentos de la empresa.
 *
 * Strappy se vende como una agencia: contratas agentes igual que contratarías
 * personas. Por eso el menú no se organiza por tecnología («WhatsApp») sino por
 * ÁREA de la empresa («Comunicaciones»), que es como piensa quien la dirige.
 * Así, añadir un community manager o un asistente administrativo es meter a
 * alguien en un departamento que ya existe, no inventar otra sección.
 *
 * La equivalencia categoría → departamento vive AQUÍ y solo aquí: el catálogo
 * (`catalog_agents.category`) es dato de producto y el menú no debe conocer sus
 * valores uno a uno. Un agente con una categoría que todavía no está en el mapa
 * cae en `otros` y sigue siendo visible en «Tu equipo»; nunca desaparece.
 */

export type DepartamentoId =
  | "comunicaciones"
  | "marketing"
  | "desarrollo"
  | "administracion"
  | "otros";

/**
 * Qué categoría del catálogo trabaja en qué departamento.
 *
 * Las claves son las de `catalog_agents.category`. Hoy la semilla usa `ventas`
 * (Recepcionista), `operaciones` (Webmaster) y `crecimiento` (Marketing); el
 * resto están puestas de antemano para los agentes que vienen.
 */
const CATEGORIA_A_DEPARTAMENTO: Readonly<Record<string, DepartamentoId>> = {
  // Comunicaciones: todo lo que habla con el cliente.
  ventas: "comunicaciones",
  atencion: "comunicaciones",
  soporte: "comunicaciones",
  comunicaciones: "comunicaciones",
  // Marketing: lo que sale a buscar clientes.
  crecimiento: "marketing",
  marketing: "marketing",
  contenido: "marketing",
  publicidad: "marketing",
  // Desarrollo: lo técnico, la web y las herramientas.
  operaciones: "desarrollo",
  desarrollo: "desarrollo",
  tecnologia: "desarrollo",
  diseno: "desarrollo",
  // Administración: dinero y papeles.
  administracion: "administracion",
  finanzas: "administracion",
  facturacion: "administracion",
  contabilidad: "administracion",
};

/** Donde cae un agente cuya categoría todavía no conocemos. */
export const DEPARTAMENTO_POR_DEFECTO: DepartamentoId = "otros";

export function departamentoDeCategoria(categoria: string | null | undefined): DepartamentoId {
  if (!categoria) return DEPARTAMENTO_POR_DEFECTO;
  return CATEGORIA_A_DEPARTAMENTO[categoria.trim().toLowerCase()] ?? DEPARTAMENTO_POR_DEFECTO;
}

export interface FichaDepartamento {
  readonly id: DepartamentoId;
  readonly etiqueta: string;
  /** Una línea, en palabras de quien dirige el negocio. */
  readonly descripcion: string;
}

export const DEPARTAMENTOS: Readonly<Record<DepartamentoId, FichaDepartamento>> = {
  comunicaciones: {
    id: "comunicaciones",
    etiqueta: "Comunicaciones",
    descripcion: "Quien habla con tus clientes: WhatsApp, la bandeja y lo que saben de tu negocio.",
  },
  marketing: {
    id: "marketing",
    etiqueta: "Marketing",
    descripcion: "Quien sale a buscar clientes: campañas, anuncios y contenidos.",
  },
  desarrollo: {
    id: "desarrollo",
    etiqueta: "Desarrollo",
    descripcion: "Quien mantiene tu web y tus herramientas.",
  },
  administracion: {
    id: "administracion",
    etiqueta: "Administración",
    descripcion: "Quien lleva las facturas, los cobros y las cuentas.",
  },
  otros: {
    id: "otros",
    etiqueta: "Otros",
    descripcion: "Agentes que todavía no encajan en ningún departamento.",
  },
};

/**
 * Los departamentos con pantalla propia de agentes, en el orden del menú.
 *
 * Comunicaciones no está: sus agentes viven en su propia pantalla de WhatsApp,
 * que existe desde antes y tiene bandeja, contactos y conocimiento alrededor.
 * `otros` tampoco: no es un departamento de verdad, es la red de seguridad para
 * que un agente con categoría nueva no quede invisible.
 */
export const DEPARTAMENTOS_CON_PANTALLA: readonly DepartamentoId[] = [
  "marketing",
  "desarrollo",
  "administracion",
];

export function esDepartamentoConPantalla(valor: string): valor is DepartamentoId {
  return (DEPARTAMENTOS_CON_PANTALLA as readonly string[]).includes(valor);
}
