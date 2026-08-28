/**
 * El vocabulario que comparten el servidor y la interfaz de Strap.
 *
 * TODA la interfaz enriquecida se pinta desde la SALIDA de una herramienta,
 * nunca desde el texto del modelo. Por eso cada herramienta que produce algo
 * visible devuelve uno de estos objetos, con su discriminante: el componente
 * hace `switch` sobre un dato tipado y no hay ni un `parse` de texto en toda
 * la pantalla.
 *
 * El proyecto anterior emitía bloques `<tarea>{json}</tarea>` dentro de la
 * respuesta y tenía un clasificador de respaldo para cuando el modelo se
 * equivocaba de formato. Ese clasificador es la deuda que este archivo existe
 * para no volver a contraer.
 */
import type { FaseMeta } from "@strappy/core";

export type ModoConstruccion = "lite" | "max";

// ---------------------------------------------------------------------------
// 1 · Opciones
// ---------------------------------------------------------------------------

export type OpcionPregunta = {
  readonly valor: string;
  readonly etiqueta: string;
  readonly pista?: string;
};

export type PreguntaRenderizada = {
  readonly clave: string;
  readonly enunciado: string;
  /** Como mucho cuatro: a partir de ahí ya no se elige, se lee. */
  readonly opciones: readonly OpcionPregunta[];
  readonly multiple: boolean;
  /** La persona puede escribir algo que no está en la lista. */
  readonly abierta: boolean;
};

export type SalidaPreguntar = {
  readonly tipo: "preguntas";
  readonly preguntas: readonly PreguntaRenderizada[];
  readonly fase: FaseMeta;
};

// ---------------------------------------------------------------------------
// 2 · Checklist de confirmación
// ---------------------------------------------------------------------------

export type ItemChecklist = {
  /** Ruta dentro del borrador: es lo que se edita en línea. */
  readonly clave: string;
  readonly etiqueta: string;
  readonly valor: string;
  /** Los que no se editan aquí (una lista larga, un cerebro ya indexado). */
  readonly editable: boolean;
};

export type SalidaChecklist = {
  readonly tipo: "checklist";
  readonly titulo: string;
  readonly items: readonly ItemChecklist[];
  readonly aviso?: string;
};

// ---------------------------------------------------------------------------
// 3 · Tarjeta de entidad creada
// ---------------------------------------------------------------------------

export type SalidaTarjeta = {
  readonly tipo: "tarjeta";
  readonly entidad: "agente" | "cerebro";
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly detalles: readonly { etiqueta: string; valor: string }[];
  readonly enlace: string;
  readonly textoEnlace: string;
  /** Versión publicada. Su presencia es lo que hace real la celebración. */
  readonly version?: number;
};

// ---------------------------------------------------------------------------
// 4 · Progreso de construcción
// ---------------------------------------------------------------------------

export type EstadoPaso = "hecho" | "corriendo" | "fallido" | "omitido";

export type PasoConstruccion = {
  readonly etiqueta: string;
  readonly estado: EstadoPaso;
  readonly detalle?: string;
};

export type SalidaProgreso = {
  readonly tipo: "progreso";
  readonly titulo: string;
  readonly pasos: readonly PasoConstruccion[];
  /** Frase de una línea a la que colapsa cuando termina. */
  readonly resumen: string;
};

// ---------------------------------------------------------------------------
// 5 · Auto-juego
// ---------------------------------------------------------------------------

export type TurnoAutojuego = {
  readonly quien: "cliente" | "agente";
  readonly texto: string;
};

export type SalidaAutojuego = {
  readonly tipo: "autojuego";
  readonly guion: string;
  readonly turnos: readonly TurnoAutojuego[];
  /** Lo que el agente consiguió averiguar solo. Es la prueba de que funciona. */
  readonly variables: readonly { clave: string; etiqueta: string; valor: string }[];
  readonly aviso?: string;
};

export type SalidaContexto = {
  readonly tipo: "contexto";
  readonly empresa: Readonly<Record<string, string>>;
  readonly conocido: readonly string[];
};

export type SalidaBorrador = {
  readonly tipo: "borrador";
  readonly fase: FaseMeta;
  readonly borrador: Record<string, unknown>;
  readonly pendientes: readonly string[];
};

export type SalidaTexto = {
  readonly tipo: "texto";
  readonly titulo: string;
  readonly cuerpo: string;
};

export type SalidaHerramientaStrap =
  | SalidaPreguntar
  | SalidaChecklist
  | SalidaTarjeta
  | SalidaProgreso
  | SalidaAutojuego
  | SalidaContexto
  | SalidaBorrador
  | SalidaTexto;

// ---------------------------------------------------------------------------
// Hilos
// ---------------------------------------------------------------------------

export type ResumenHilo = {
  readonly id: string;
  readonly titulo: string;
  readonly fase: FaseMeta;
  readonly etiquetaFase: string;
  readonly actualizado: string;
  readonly publicado: boolean;
};

/** Chips de intención de la pantalla de inicio. */
export type ChipIntencion = {
  readonly id: string;
  readonly etiqueta: string;
  readonly mensaje: string;
  readonly icono: "bot" | "whatsapp" | "catalogo" | "catalogo-agentes";
};

export const CHIPS_INTENCION: readonly ChipIntencion[] = [
  {
    id: "crear-agente",
    etiqueta: "Crear un agente para WhatsApp",
    mensaje: "Quiero crear un agente que atienda a mis clientes por WhatsApp.",
    icono: "bot",
  },
  {
    id: "conectar-whatsapp",
    etiqueta: "Conectar mi WhatsApp",
    mensaje: "Quiero conectar mi número de WhatsApp a Strappy.",
    icono: "whatsapp",
  },
  {
    id: "subir-catalogo",
    etiqueta: "Subir mi catálogo o mis precios",
    mensaje: "Quiero que mi agente conozca mi catálogo y mis precios.",
    icono: "catalogo",
  },
  {
    id: "contratar",
    etiqueta: "Contratar un agente listo",
    mensaje: "Prefiero contratar un agente ya hecho en vez de construir uno.",
    icono: "catalogo-agentes",
  },
];
