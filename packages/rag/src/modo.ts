/**
 * Modo del conocimiento: «completo» o «solo texto».
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (no es un apaño, no lo borres):
 *
 * La cartera de modelos del proyecto es OpenRouter, y OpenRouter no tiene
 * endpoint de embeddings: solo conversación. Sin una clave de un proveedor que
 * sí los ofrezca, cualquier intento de vectorizar termina en «AI Gateway
 * authentication failed», la ingesta falla entera y el Cerebro se queda vacío.
 * Un agente que responde sin el catálogo del cliente degrada con elegancia,
 * pero degrada: sin Cerebros el producto pierde la mitad de su valor.
 *
 * La salida no es apagar el conocimiento, es apagar SOLO la mitad semántica.
 * La mitad léxica (`to_tsvector` + `ts_rank_cd` en español) ya está construida,
 * es gratis y encuentra nombres de producto, precios y referencias literales.
 * Así que cuando no hay proveedor de embeddings el sistema entra en modo solo
 * texto A PROPÓSITO Y DICIÉNDOLO —no por un error atrapado— y el conocimiento
 * sigue funcionando desde el primer minuto.
 *
 * El día que exista una clave, el modo completo se enciende solo: basta con
 * poner `OPENAI_API_KEY`. Los embeddings de `text-embedding-3-small` cuestan
 * 0,02 USD por millón de tokens; indexar un catálogo entero cuesta céntimos.
 */

export type ModoConocimiento = "completo" | "solo-texto";

/**
 * Variables que habilitan el modo completo, en orden de preferencia.
 * `OPENAI_API_KEY` primero: es la ruta directa a OpenAI, sin pasarela de por
 * medio, y es la que basta poner para encender los embeddings.
 */
export const VARIABLES_DE_EMBEDDINGS = ["OPENAI_API_KEY", "AI_GATEWAY_API_KEY"] as const;

export type Entorno = Readonly<Record<string, string | undefined>>;

export type DiagnosticoModo = {
  readonly modo: ModoConocimiento;
  /** Qué variable de entorno habilitó el modo completo, si alguna. */
  readonly variable: string | null;
  /** Explicación técnica, para registros y para la consola. */
  readonly motivo: string;
  /** Explicación para el cliente, sin una sola palabra de jerga. */
  readonly explicacion: string;
};

/**
 * Lee `process.env` sin depender de los tipos de Node: este paquete se compila
 * con `lib: ES2023` a secas y no debe arrastrar `@types/node`.
 */
function entornoDelProceso(): Entorno {
  const global = globalThis as { process?: { env?: Entorno } };
  return global.process?.env ?? {};
}

function valorNoVacio(entorno: Entorno, clave: string): string | null {
  const valor = entorno[clave];
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** Primera variable de embeddings con valor, o `null` si no hay ninguna. */
export function claveDeEmbeddings(entorno: Entorno = entornoDelProceso()): {
  variable: string;
  valor: string;
} | null {
  for (const variable of VARIABLES_DE_EMBEDDINGS) {
    const valor = valorNoVacio(entorno, variable);
    if (valor !== null) return { variable, valor };
  }
  return null;
}

/**
 * ¿Hay proveedor de embeddings? Es la única pregunta que decide el modo, y se
 * hace ANTES de intentar nada: el modo solo texto es una decisión, no el
 * resultado de atrapar un 401.
 */
export function hayProveedorDeEmbeddings(entorno: Entorno = entornoDelProceso()): boolean {
  return claveDeEmbeddings(entorno) !== null;
}

/** Texto para el cliente. Prohibido: «embedding», «vector», «similitud coseno». */
export function explicacionDelModo(modo: ModoConocimiento): string {
  return modo === "completo"
    ? "El cerebro entiende el significado de la pregunta: encuentra la respuesta aunque esté escrita con otras palabras."
    : "El cerebro está buscando por coincidencia de palabras, no por significado. " +
        "Acierta cuando la pregunta usa las mismas palabras que tus documentos: nombres de producto, precios y referencias exactas. " +
        "Puede no encontrar nada si la misma cosa se pregunta de otra manera.";
}

export function detectarModoConocimiento(entorno: Entorno = entornoDelProceso()): DiagnosticoModo {
  const clave = claveDeEmbeddings(entorno);
  if (clave) {
    return {
      modo: "completo",
      variable: clave.variable,
      motivo: `Hay proveedor de embeddings (${clave.variable}): búsqueda por significado y por palabras.`,
      explicacion: explicacionDelModo("completo"),
    };
  }
  return {
    modo: "solo-texto",
    variable: null,
    motivo:
      `No hay proveedor de embeddings (falta ${VARIABLES_DE_EMBEDDINGS.join(" o ")}). ` +
      "Modo solo texto: se indexa y se busca únicamente por coincidencia de palabras. " +
      "Poner OPENAI_API_KEY activa el modo completo sin tocar código ni reingerir.",
    explicacion: explicacionDelModo("solo-texto"),
  };
}

/**
 * Modo efectivo de una operación concreta.
 *
 * Quien monta el sistema decide inyectando o no el puerto de embeddings, y esa
 * ausencia se respeta tal cual: sin proveedor, solo texto. `forzarSoloTexto`
 * existe para las pruebas y para poder apagar la mitad semántica a mano.
 */
export function modoEfectivo(input: {
  embeddings?: unknown;
  forzarSoloTexto?: boolean;
}): ModoConocimiento {
  if (input.forzarSoloTexto === true) return "solo-texto";
  return input.embeddings ? "completo" : "solo-texto";
}
