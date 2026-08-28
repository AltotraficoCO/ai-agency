/**
 * El vocabulario de la bandeja. Lo comparten servidor y navegador, así que aquí
 * no entra nada de Postgres ni de React: solo formas de datos.
 *
 * LA TESIS: el color codifica quién habla. `QuienHabla` es el tipo que la
 * sostiene, y toda burbuja, avatar y barra del hilo se pinta a partir de él.
 * Índigo = la IA. Fucsia = tu equipo. Neutro elevado = el cliente. Neutro medio
 * = el sistema. Si algún día una burbuja elige su color por otra vía, la tesis
 * se rompió.
 */

/** Quién escribió. Es la única fuente del color en todo el hilo. */
export type QuienHabla = "ia" | "humano" | "cliente" | "sistema";

/**
 * Quién manda en la conversación, ya resuelto para la persona que mira.
 * El esquema guarda tres señales (`handover_state`, `bot_enabled`,
 * `bot_paused_until`) más el asignado; la barra de control solo entiende esto.
 */
export type EstadoMando =
  /** La IA está atendiendo. El composer se bloquea. */
  | "ia"
  /** Tú tienes el control. */
  | "tuyo"
  /** Otra persona del equipo tiene el control. El composer se bloquea. */
  | "otro"
  /** Nadie contesta: el bot está en pausa y ninguna persona lo tomó. */
  | "pausado";

export type EstadoEnvio = "pending" | "sent" | "delivered" | "read" | "failed";

export type Persona = {
  readonly id: string;
  readonly nombre: string;
  readonly avatar?: string;
};

export type Etiqueta = {
  readonly id: string;
  readonly nombre: string;
  /** Uno de `PALETA_ETIQUETAS`. Nunca un color semántico. */
  readonly color: string;
};

/**
 * Ocho neutros teñidos.
 *
 * Deliberadamente NO son los semánticos: si una etiqueta pudiera ser roja, el
 * rojo dejaría de significar «algo va mal» y el hilo perdería su idioma. Son
 * neutros con una gota de matiz, legibles en claro y en oscuro.
 */
export const PALETA_ETIQUETAS: readonly { clave: string; nombre: string; hex: string }[] = [
  { clave: "pizarra", nombre: "Pizarra", hex: "#64748B" },
  { clave: "lavanda", nombre: "Lavanda", hex: "#7C77A8" },
  { clave: "ciruela", nombre: "Ciruela", hex: "#8E6E93" },
  { clave: "arcilla", nombre: "Arcilla", hex: "#9A7B6C" },
  { clave: "oliva", nombre: "Oliva", hex: "#7C8B6A" },
  { clave: "pino", nombre: "Pino", hex: "#5F8A7C" },
  { clave: "acero", nombre: "Acero", hex: "#5E7E97" },
  { clave: "grafito", nombre: "Grafito", hex: "#6B7280" },
];

/**
 * Restricción de envío tal y como la devuelve el canal.
 *
 * `mensaje` viene REDACTADO por el adaptador del canal. La bandeja lo enseña
 * literal: no lo reescribe, no lo interpreta y no reimplementa la ventana de 24
 * horas. Si mañana WhatsApp cambia la regla, cambia el canal y la bandeja no se
 * entera.
 */
export type Restriccion = {
  readonly codigo: string;
  readonly mensaje: string;
  readonly expiraEl?: string;
  readonly alternativa?: { readonly tipo: string; readonly etiqueta: string };
};

export type Canal = {
  readonly id: string;
  readonly tipo: string;
  readonly nombre: string;
};

export type ConversacionResumen = {
  readonly id: string;
  readonly contacto: { readonly id: string; readonly nombre: string; readonly telefono?: string; readonly avatar?: string };
  readonly canal: Canal;
  readonly agente: { readonly id: string; readonly nombre: string } | null;
  readonly asignado: Persona | null;
  readonly mando: EstadoMando;
  readonly estado: "open" | "snoozed" | "closed";
  readonly sinLeer: number;
  readonly etiquetas: readonly Etiqueta[];
  readonly ultimo: { readonly texto: string; readonly quien: QuienHabla } | null;
  readonly ultimaFecha: string | null;
  readonly ultimoEntrante: string | null;
  readonly ultimoSaliente: string | null;
  readonly pospuestaHasta: string | null;
  readonly envioLibreHasta: string | null;
  /** Sin responder por encima del límite de servicio. Lo calcula `esUrgente`. */
  readonly urgente: boolean;
};

export type ElementoHilo =
  | {
      readonly clase: "mensaje";
      readonly id: string;
      readonly quien: QuienHabla;
      readonly texto: string;
      readonly tipo: string;
      readonly fecha: string;
      readonly estado: EstadoEnvio;
      readonly autor: string | null;
      readonly error: string | null;
    }
  | {
      readonly clase: "evento";
      readonly id: string;
      readonly tipo: string;
      readonly texto: string;
      readonly fecha: string;
      readonly quien: QuienHabla;
    }
  | {
      readonly clase: "nota";
      readonly id: string;
      readonly texto: string;
      readonly fecha: string;
      readonly autor: string | null;
      readonly menciones: readonly string[];
    };

export type Hilo = {
  readonly conversacion: ConversacionResumen;
  readonly elementos: readonly ElementoHilo[];
  /** Desde cuándo y de quién es el control, para la frase de la barra. */
  readonly control: { readonly desde: string | null; readonly quien: Persona | null };
  readonly envio: { readonly permitido: boolean; readonly restriccion: Restriccion | null };
  readonly resumen: string | null;
  readonly contacto: {
    readonly id: string;
    readonly nombre: string;
    readonly telefono?: string;
    readonly correo?: string;
    readonly creadoEl: string;
    readonly propiedades: Readonly<Record<string, string>>;
  };
};

export type RespuestaRapida = {
  readonly id: string;
  readonly atajo: string;
  readonly titulo: string;
  readonly cuerpo: string;
};

export type Catalogos = {
  readonly etiquetas: readonly Etiqueta[];
  readonly miembros: readonly Persona[];
  readonly respuestas: readonly RespuestaRapida[];
  readonly canales: readonly Canal[];
  readonly agentes: readonly { readonly id: string; readonly nombre: string }[];
  readonly yo: Persona;
  /** Hay al menos un canal real conectado; si no, la bandeja está en su primera vez. */
  readonly hayCanal: boolean;
};

export type Pestana = "todas" | "mias" | "sin-asignar" | "sin-leer";

export type Filtros = {
  readonly pestana: Pestana;
  readonly busqueda: string;
  readonly estado: "abiertas" | "pospuestas" | "cerradas" | "todas";
  readonly canalId: string | null;
  readonly asignadoId: string | null;
  readonly agenteId: string | null;
  readonly etiquetaId: string | null;
  readonly desde: string | null;
  readonly hasta: string | null;
  readonly soloUrgentes: boolean;
};

export const FILTROS_INICIALES: Filtros = {
  pestana: "todas",
  busqueda: "",
  estado: "abiertas",
  canalId: null,
  asignadoId: null,
  agenteId: null,
  etiquetaId: null,
  desde: null,
  hasta: null,
  soloUrgentes: false,
};

/** Cuántos filtros del panel (no las pestañas) están puestos. */
export function filtrosActivos(f: Filtros): number {
  let n = 0;
  if (f.estado !== "abiertas") n += 1;
  if (f.canalId) n += 1;
  if (f.asignadoId) n += 1;
  if (f.agenteId) n += 1;
  if (f.etiquetaId) n += 1;
  if (f.desde || f.hasta) n += 1;
  if (f.soloUrgentes) n += 1;
  return n;
}

/**
 * El acuerdo de servicio: minutos que una conversación puede quedarse sin
 * respuesta antes de que su hora se pinte en rojo y entre en «Urgentes».
 */
export const MINUTOS_SLA = 30;

/**
 * ¿Lleva demasiado esperando?
 *
 * Solo cuenta si el último mensaje es del cliente: una conversación en la que
 * el último en hablar fuiste tú no está esperando a nadie.
 */
export function esUrgente(
  input: { ultimoEntrante: string | null; ultimoSaliente: string | null; estado?: string },
  ahora: Date = new Date(),
): boolean {
  if (input.estado && input.estado !== "open") return false;
  if (!input.ultimoEntrante) return false;
  const entrante = new Date(input.ultimoEntrante).getTime();
  const saliente = input.ultimoSaliente ? new Date(input.ultimoSaliente).getTime() : 0;
  if (saliente >= entrante) return false;
  return ahora.getTime() - entrante > MINUTOS_SLA * 60_000;
}

/**
 * ¿Puede la persona escribir al cliente ahora mismo?
 *
 * Dos candados independientes y ninguno de ellos opinable:
 *   1. El mando: si contesta la IA o lo tiene otra persona, no se escribe.
 *   2. El canal: si el canal dice que no, no se escribe (y se muestra SU texto).
 * Las notas internas no pasan por aquí: no van al cliente, no las restringe el
 * canal y por eso se pueden escribir siempre.
 */
export function puedeEscribir(input: {
  mando: EstadoMando;
  envioPermitido: boolean;
}): { permitido: boolean; motivo: "mando" | "canal" | null } {
  if (input.mando !== "tuyo") return { permitido: false, motivo: "mando" };
  if (!input.envioPermitido) return { permitido: false, motivo: "canal" };
  return { permitido: true, motivo: null };
}

/** Sustituye `{{contacto.nombre}}` y compañía en una respuesta rápida. */
export function rellenarVariables(
  cuerpo: string,
  datos: Readonly<Record<string, string>>,
): string {
  return cuerpo.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (coincidencia, clave: string) => {
    const valor = datos[clave];
    return valor && valor.trim() ? valor : coincidencia;
  });
}

/** Ordena el hilo: por fecha y, a igualdad, entrante antes que saliente. */
export function ordenarElementos(elementos: readonly ElementoHilo[]): ElementoHilo[] {
  const rango = (e: ElementoHilo): number => {
    if (e.clase !== "mensaje") return 1;
    return e.quien === "cliente" ? 0 : 2;
  };
  return [...elementos].sort((a, b) => {
    const da = new Date(a.fecha).getTime();
    const db = new Date(b.fecha).getTime();
    if (da !== db) return da - db;
    const ra = rango(a);
    const rb = rango(b);
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
