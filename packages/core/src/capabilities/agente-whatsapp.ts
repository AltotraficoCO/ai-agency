/**
 * La primera capacidad real de Strap: construir un agente que atiende por
 * mensajería.
 *
 * Esto es el archivo que hay que copiar para enseñarle a construir otra cosa.
 * No hay lógica: hay un esquema, unas fases y unas preguntas. Que dar de alta
 * una capacidad nueva sea escribir datos —y no tocar el prompt ni el motor— es
 * la única razón por la que este registro existe.
 */
import { z } from "zod";
import type { CapabilityDef } from "../registry/capability.js";

/** Etiquetas legibles de los datos a recoger, para no repetirlas en la interfaz. */
export const ETIQUETAS_RECOGER: Readonly<Record<string, string>> = {
  nombre: "nombre",
  telefono: "teléfono",
  correo: "correo",
  ciudad: "ciudad",
  interes: "producto de interés",
  presupuesto: "presupuesto",
};


export const CAPACIDAD_AGENTE_MENSAJERIA = "agente_mensajeria";

/**
 * Lo que se guarda cuando la persona dice que no tiene web.
 *
 * Tiene que ser un valor y no un hueco: con la cadena vacía la pregunta se
 * daba por no contestada y volvía a salir en cada ronda.
 */
export const SIN_SITIO_WEB = "sin sitio web";

/** True si el valor parece una dirección que se puede leer, no una negativa. */
export function esSitioWeb(valor: unknown): valor is string {
  return typeof valor === "string" && valor !== SIN_SITIO_WEB && /\S+\.\S+/.test(valor.trim());
}

const campoARecoger = z.object({
  clave: z.string().min(1),
  etiqueta: z.string().min(1),
  pista: z.string().optional(),
  obligatorio: z.boolean().optional(),
});

/**
 * Un dato a recoger admite escribirse como texto suelto.
 *
 * Los modelos económicos mandan `["nombre", "telefono"]` la mitad de las
 * veces, y rechazarlo obliga a un turno entero de correccion que la persona
 * ve como un tartamudeo. Aceptarlo y completarlo cuesta tres líneas.
 */
const campoFlexible = z.preprocess(
  (valor) =>
    typeof valor === "string"
      ? { clave: valor, etiqueta: ETIQUETAS_RECOGER[valor] ?? valor }
      : valor,
  campoARecoger,
);

/**
 * El borrador. Cada rama corresponde a una pregunta o a un resultado de
 * herramienta; nada aquí es un campo de conveniencia de la interfaz.
 */
export const esquemaBorradorAgente = z
  .object({
    empresa: z
      .object({
        nombre: z.string().optional(),
        sitioWeb: z.string().optional(),
        sector: z.string().optional(),
        descripcion: z.string().optional(),
        horario: z.string().optional(),
        politicas: z.array(z.string()).optional(),
      })
      .default({}),
    agente: z
      .object({
        nombre: z.string().optional(),
        proposito: z.string().optional(),
        tono: z.string().optional(),
        idioma: z.string().optional(),
      })
      .default({}),
    // Strap solo construye agentes de atención por WhatsApp: el canal ya no se
    // pregunta, se da por hecho. El enum se conserva para los borradores viejos.
    canal: z.enum(["whatsapp", "webchat", "simulador"]).default("whatsapp"),
    objetivo: z.string().optional(),
    hace: z.array(z.string()).default([]),
    noHace: z.array(z.string()).default([]),
    recoger: z.array(campoFlexible).default([]),
    escalar: z.array(z.string()).default([]),
    /** Instrucciones ya compiladas por `generar_prompt_agente`. */
    instrucciones: z.string().optional(),
    /** URLs analizadas y páginas que salieron de cada una. */
    fuentes: z
      .array(z.object({ url: z.string(), paginas: z.number().int().nonnegative() }))
      .default([]),
    cerebroId: z.string().optional(),
    /** Se rellenan al publicar. Su presencia es lo que hace la entrega real. */
    agenteId: z.string().optional(),
    versionId: z.string().optional(),
    huellaPrompt: z.string().optional(),
  })
  // Estricto a propósito. Un modelo economico escribe `agente_nombre` en vez de
  // `agente.nombre` con una regularidad deprimente, y con un esquema permisivo
  // eso se guarda como basura al lado del campo bueno: la pregunta vuelve a
  // salir, la persona la contesta otra vez y nadie entiende por qué. Fallar
  // aquí devuelve al modelo un mensaje que puede corregir en el mismo turno.
  .strict();

export type BorradorAgente = z.infer<typeof esquemaBorradorAgente>;

export const BORRADOR_AGENTE_VACIO: BorradorAgente = esquemaBorradorAgente.parse({});

export const capacidadAgenteMensajeria: CapabilityDef = {
  slug: CAPACIDAD_AGENTE_MENSAJERIA,
  label: "Crear un agente de atención para WhatsApp",
  icon: "bot",
  description:
    "Construye un agente que atiende a tus clientes por WhatsApp: sabe de tu negocio, recoge los datos que te importan y sabe cuándo pasarle la conversación a una persona.",
  produces: { kind: "agent", agentType: "conversational" },
  draftSchema: esquemaBorradorAgente,
  internalFields: ["fuentes", "cerebroId", "agenteId", "versionId", "huellaPrompt", "instrucciones"],
  phases: [
    {
      slug: "intencion",
      goal: "Saber para qué atiende el agente de WhatsApp y de dónde sacar el contexto del negocio.",
      questions: [
        {
          key: "agente.proposito",
          prompt: "¿Qué quieres que haga tu agente en WhatsApp?",
          // Un mismo agente vende Y resuelve dudas: obligar a elegir una sola
          // era lo primero que la persona sentía como un formulario mal hecho.
          multiple: true,
          allowFreeText: true,
          options: [
            { value: "vender", label: "Atender ventas", hint: "Precios, catálogo y cierre" },
            { value: "soporte", label: "Resolver dudas", hint: "Preguntas frecuentes y postventa" },
            { value: "agendar", label: "Agendar citas", hint: "Disponibilidad y reservas" },
            { value: "calificar", label: "Calificar prospectos", hint: "Filtrar antes de pasar al equipo" },
          ],
        },
        {
          key: "empresa.sitioWeb",
          prompt: "¿Tienes un sitio web para que lo lea y aprenda de tu negocio?",
          allowFreeText: true,
          options: [
            { value: SIN_SITIO_WEB, label: "No tengo sitio web", hint: "Lo montamos con lo que me cuentes" },
          ],
        },
      ],
    },
    {
      slug: "recoleccion_1",
      goal: "Cerrar el contexto de la empresa que el agente no puede inventarse.",
      questions: [
        { key: "empresa.nombre", prompt: "¿Cómo se llama tu negocio?", allowFreeText: true },
        {
          key: "empresa.sector",
          prompt: "¿A qué se dedica?",
          options: [
            { value: "comercio", label: "Comercio o tienda" },
            { value: "servicios", label: "Servicios profesionales" },
            { value: "salud", label: "Salud y bienestar" },
            { value: "educacion", label: "Educación" },
          ],
          allowFreeText: true,
        },
        {
          key: "empresa.horario",
          prompt: "¿Cuándo atienden?",
          options: [
            { value: "24/7", label: "Siempre", hint: "El agente responde a cualquier hora" },
            { value: "lunes a viernes, 8:00 a 18:00", label: "Días hábiles, horario de oficina" },
            { value: "lunes a sábado, 9:00 a 19:00", label: "De lunes a sábado" },
          ],
          allowFreeText: true,
        },
      ],
    },
    {
      slug: "recoleccion_2",
      goal: "Darle nombre, voz y límites al agente, y decidir qué datos debe averiguar.",
      questions: [
        { key: "agente.nombre", prompt: "¿Cómo quieres que se llame tu agente?", allowFreeText: true },
        {
          key: "agente.tono",
          prompt: "¿Cómo habla con tus clientes?",
          options: [
            { value: "cercano y breve, tutea", label: "Cercano y breve", hint: "Tutea, frases cortas" },
            { value: "profesional y cordial, trata de usted", label: "Profesional", hint: "Trata de usted" },
            { value: "cálido y detallado, tutea", label: "Cálido", hint: "Se toma su tiempo" },
            { value: "directo y resolutivo, tutea", label: "Directo", hint: "Va al grano" },
          ],
        },
        {
          key: "hace",
          prompt: "¿Qué debe hacer con tus clientes?",
          multiple: true,
          allowFreeText: true,
          options: [
            { value: "Responde precios y disponibilidad", label: "Responder precios" },
            { value: "Toma pedidos o reservas", label: "Tomar pedidos o reservas" },
            { value: "Resuelve dudas frecuentes", label: "Resolver dudas frecuentes" },
            { value: "Pasa el contacto a una persona del equipo", label: "Pasar el contacto al equipo" },
          ],
        },
        {
          key: "recoger",
          prompt: "¿Qué datos quieres que averigüe durante la conversación?",
          multiple: true,
          options: [
            { value: "nombre", label: "Su nombre" },
            { value: "telefono", label: "Un teléfono de contacto" },
            { value: "ciudad", label: "La ciudad" },
            { value: "interes", label: "Qué producto o servicio le interesa" },
          ],
        },
      ],
    },
    {
      slug: "confirmacion",
      goal: "Enseñar la ficha completa y editable antes de tocar nada en la base.",
      questions: [],
    },
    { slug: "construccion", goal: "Compilar el prompt, indexar el conocimiento y publicar.", questions: [] },
    { slug: "reporte", goal: "Contar qué quedó construido, en las palabras de la persona.", questions: [] },
    { slug: "prueba", goal: "Enseñar el agente funcionando sin que la persona escriba nada.", questions: [] },
    { slug: "entrega", goal: "Entregar la tarjeta del agente y el siguiente paso.", questions: [] },
  ],
  tools: [
    "leer_contexto_empresa",
    "analizar_sitio_web",
    "preguntar",
    "draft_leer",
    "draft_actualizar",
    "generar_prompt_agente",
    "proponer_variables_extraccion",
    "crear_brain_desde_fuentes",
    "confirmar_construccion",
    "publicar_agente",
    "probar_agente",
    "mostrar_tarjeta_agente",
  ],
  verify: {
    kind: "simulator",
    scenarios: [
      "cliente interesado con presupuesto bajo",
      "cliente con prisa que solo pregunta el precio",
      "cliente molesto que pide hablar con una persona",
    ],
  },
};

/**
 * Del borrador de Strap al `spec` que guarda `agent_versions`.
 *
 * Vive aquí, junto a la capacidad, y no en la aplicación: es parte del
 * contrato de lo que esta capacidad PRODUCE. Es determinista a propósito —el
 * hash del prompt publicado depende de ella.
 */
export function borradorAEspecificacion(borrador: BorradorAgente): {
  identidad: { nombre: string; idioma: string; tono: string; proposito: string };
  objetivo?: string;
  hace: string[];
  noHace: string[];
  recoger: { clave: string; etiqueta: string; pista?: string; obligatorio?: boolean }[];
  escalar: string[];
  instruccionesManuales?: string;
} {
  return {
    identidad: {
      nombre: borrador.agente?.nombre?.trim() || "Asistente",
      idioma: borrador.agente?.idioma?.trim() || "español",
      tono: borrador.agente?.tono?.trim() || "cercano y claro",
      proposito: borrador.agente?.proposito?.trim() || "atender a quien escribe",
    },
    ...(borrador.objetivo ? { objetivo: borrador.objetivo } : {}),
    hace: [...borrador.hace],
    noHace: [...borrador.noHace],
    recoger: borrador.recoger.map((c) => ({
      clave: c.clave,
      etiqueta: c.etiqueta,
      ...(c.pista ? { pista: c.pista } : {}),
      ...(c.obligatorio ? { obligatorio: true } : {}),
    })),
    escalar: [...borrador.escalar],
    ...(borrador.instrucciones?.trim() ? { instruccionesManuales: borrador.instrucciones } : {}),
  };
}
