/**
 * «Mejorar con IA»: la parte que no habla con el modelo.
 *
 * Aquí vive todo lo que se puede probar sin clave ni red: qué se le pide al
 * modelo, qué forma tiene que devolver y —lo más delicado— cómo se mezcla su
 * propuesta con lo que la persona ya tenía escrito.
 *
 * La regla que gobierna el archivo: **la propuesta no reemplaza la ficha, se
 * aplica por secciones y solo donde la persona acepta**. Un botón que reescribe
 * de golpe el trabajo de alguien no es una mejora, es una pérdida.
 */
import { z } from "zod";
import { SECCIONES, type ClaveSeccion, type EspecificacionAgente } from "@strappy/db/spec";

/** Las secciones que la mejora puede tocar. `recoger` no entra: ver abajo. */
export const SECCIONES_MEJORABLES = ["identidad", "hace", "noHace", "escalar"] as const;
export type SeccionMejorable = (typeof SECCIONES_MEJORABLES)[number];

export function esSeccionMejorable(valor: string): valor is SeccionMejorable {
  return (SECCIONES_MEJORABLES as readonly string[]).includes(valor);
}

/**
 * Lo que el modelo devuelve.
 *
 * Todo opcional a propósito: si una sección ya estaba bien, el modelo la deja
 * fuera y esa sección no aparece como cambio. Obligar a devolverlo todo
 * garantizaría reescrituras cosméticas que la persona tendría que revisar una
 * por una.
 *
 * `recoger` NO está: los datos a recoger llevan una clave técnica que usan las
 * automatizaciones y la ficha del contacto. Que un modelo las renombre rompería
 * integraciones en silencio, y ese riesgo no compensa el beneficio.
 */
export const esquemaMejora = z.object({
  identidad: z
    .object({
      proposito: z.string().max(300).optional(),
      tono: z.string().max(300).optional(),
    })
    .optional(),
  hace: z.array(z.string().min(3).max(240)).max(12).optional(),
  noHace: z.array(z.string().min(3).max(240)).max(12).optional(),
  escalar: z.array(z.string().min(3).max(240)).max(12).optional(),
  /** Una frase, en el idioma del cliente, sobre qué se mejoró y por qué. */
  resumen: z.string().max(400),
});

export type Mejora = z.infer<typeof esquemaMejora>;

/** Un cambio propuesto, listo para enseñar en un antes/después. */
export type CambioPropuesto = {
  readonly seccion: SeccionMejorable;
  readonly titulo: string;
  readonly antes: readonly string[];
  readonly despues: readonly string[];
};

const iguales = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v.trim() === (b[i] ?? "").trim());

/** La identidad, leída como dos líneas: es lo que se compara y lo que se enseña. */
function identidadComoLineas(proposito: string, tono: string): string[] {
  return [
    `Para qué existe: ${proposito.trim() || "—"}`,
    `Cómo habla: ${tono.trim() || "—"}`,
  ];
}

function limpiar(valores: readonly string[] | undefined): string[] | null {
  if (!valores) return null;
  const limpios = valores.map((v) => v.trim()).filter((v) => v.length > 0);
  return limpios.length > 0 ? limpios : null;
}

/**
 * Qué cambiaría de verdad.
 *
 * Solo entra lo que difiere de lo que ya hay: una propuesta que repite la ficha
 * palabra por palabra no es un cambio, y enseñarla como tal haría desconfiar
 * del botón entero.
 */
export function cambiosDeLaMejora(
  spec: EspecificacionAgente,
  mejora: Mejora,
): CambioPropuesto[] {
  const cambios: CambioPropuesto[] = [];

  const proposito = mejora.identidad?.proposito?.trim();
  const tono = mejora.identidad?.tono?.trim();
  if (proposito !== undefined || tono !== undefined) {
    const antes = identidadComoLineas(spec.identidad.proposito, spec.identidad.tono);
    const despues = identidadComoLineas(
      proposito ?? spec.identidad.proposito,
      tono ?? spec.identidad.tono,
    );
    if (!iguales(antes, despues)) {
      cambios.push({ seccion: "identidad", titulo: SECCIONES.identidad, antes, despues });
    }
  }

  for (const seccion of ["hace", "noHace", "escalar"] as const) {
    const propuesto = limpiar(mejora[seccion]);
    if (!propuesto) continue;
    const antes = spec[seccion];
    if (iguales(antes, propuesto)) continue;
    cambios.push({
      seccion,
      titulo: SECCIONES[seccion as ClaveSeccion],
      antes,
      despues: propuesto,
    });
  }

  return cambios;
}

/**
 * Aplica solo las secciones aceptadas.
 *
 * Lo que no se acepta se queda EXACTAMENTE como estaba, y lo que la mejora no
 * toca tampoco se pierde: el nombre del agente, los datos a recoger, las
 * variables y las instrucciones escritas a mano viajan intactos. Que esto se
 * cumpla no es cuestión de cuidado al escribir el objeto: hay un test que lo
 * comprueba campo por campo.
 */
export function aplicarMejora(
  spec: EspecificacionAgente,
  mejora: Mejora,
  aceptadas: readonly SeccionMejorable[],
): EspecificacionAgente {
  const acepta = new Set(aceptadas);
  const siguiente: EspecificacionAgente = { ...spec, identidad: { ...spec.identidad } };

  if (acepta.has("identidad")) {
    const proposito = mejora.identidad?.proposito?.trim();
    const tono = mejora.identidad?.tono?.trim();
    if (proposito) siguiente.identidad.proposito = proposito;
    if (tono) siguiente.identidad.tono = tono;
  }
  for (const seccion of ["hace", "noHace", "escalar"] as const) {
    if (!acepta.has(seccion)) continue;
    const propuesto = limpiar(mejora[seccion]);
    if (propuesto) siguiente[seccion] = propuesto;
  }

  return siguiente;
}

// ---------------------------------------------------------------------------
// Lo que se le pide al modelo
// ---------------------------------------------------------------------------

/**
 * Las reglas del redactor.
 *
 * Están escritas como prohibiciones concretas porque son las que evitan los
 * tres desastres de este botón: inventarse el negocio, prometer cosas en su
 * nombre y devolver adjetivos donde hacía falta una instrucción.
 */
export const SISTEMA_MEJORA = [
  "Eres un redactor de instrucciones para agentes de atención al cliente.",
  "Recibes la ficha que escribió el dueño de un negocio y devuelves una versión mejor.",
  "",
  "Qué es mejor, en concreto:",
  "- Instrucciones que se pueden seguir, no adjetivos. «Responde el precio solo si está",
  "  en el catálogo» sirve; «sé profesional» no.",
  "- Límites explícitos: qué NO debe decir ni prometer.",
  "- Qué hacer cuando no sabe algo, en vez de dejarlo a su criterio.",
  "- Frases cortas, en segunda persona («respondes», «no prometes»).",
  "",
  "Prohibido, sin excepciones:",
  "- Inventar datos del negocio: precios, horarios, plazos, direcciones, garantías,",
  "  formas de pago o nombres de productos que no estén en la ficha.",
  "- Añadir promesas comerciales: descuentos, envíos gratis, devoluciones, plazos de",
  "  entrega o compensaciones. Eso lo decide la empresa, no tú.",
  "- Cambiar el nombre del agente.",
  "- Cambiar el idioma: escribes en el idioma de la ficha.",
  "- Repetir una sección tal cual estaba. Si ya está bien, déjala fuera.",
  "",
  "Devuelves solo las secciones que mejoras, y un resumen de una frase, en el",
  "idioma de la ficha, explicando qué cambiaste.",
].join("\n");

/** Una ficha casi en blanco: ahí el trabajo es proponer un punto de partida. */
export function fichaSinContenido(spec: EspecificacionAgente): boolean {
  return (
    !spec.identidad.proposito.trim() &&
    !spec.identidad.tono.trim() &&
    spec.hace.length === 0 &&
    spec.noHace.length === 0
  );
}

/** El estado actual del agente, tal cual, para que el modelo parta de lo suyo. */
export function entradaDeMejora(spec: EspecificacionAgente, contexto?: string): string {
  const lista = (valores: readonly string[]) =>
    valores.length > 0 ? valores.map((v) => `- ${v}`).join("\n") : "(vacío)";

  const partes = [
    `Idioma de la ficha: ${spec.identidad.idioma || "español"}.`,
    `Nombre del agente: ${spec.identidad.nombre || "(sin nombre)"}. No lo cambies.`,
    "",
    `## ${SECCIONES.identidad}`,
    `Para qué existe: ${spec.identidad.proposito || "(vacío)"}`,
    `Cómo habla: ${spec.identidad.tono || "(vacío)"}`,
    "",
    `## ${SECCIONES.hace}`,
    lista(spec.hace),
    "",
    `## ${SECCIONES.noHace}`,
    lista(spec.noHace),
    "",
    `## ${SECCIONES.escalar}`,
    lista(spec.escalar),
  ];

  if (contexto?.trim()) {
    partes.push("", "## Lo que sabemos del negocio", contexto.trim());
  }

  partes.push(
    "",
    fichaSinContenido(spec)
      ? "La ficha está casi vacía: propón un punto de partida razonable para este agente, sin inventar datos del negocio."
      : "Mejora solo lo que lo necesite. Lo que ya esté bien, déjalo fuera de tu respuesta.",
  );

  return partes.join("\n");
}
