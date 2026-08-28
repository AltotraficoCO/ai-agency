/**
 * El borrador: qué se sabe ya y qué falta por preguntar.
 *
 * Todo lo de este archivo es puro. Es deliberado: la regla de «nunca preguntes
 * algo que ya sabes» no puede depender de que el modelo se acuerde. Se calcula
 * aquí, se le entrega ya resuelta en el prompt, y el modelo solo la pronuncia.
 *
 * Es la diferencia entre un asistente que se siente listo y un formulario que
 * se repite.
 */
import type { ZodType } from "zod";
import type { CapabilityDef, CapabilityQuestion } from "../registry/capability.js";
import type { FaseMeta } from "./fases.js";

/** Más de tres preguntas por ronda es un formulario disfrazado de chat. */
export const MAXIMO_PREGUNTAS_POR_RONDA = 3;

export type Borrador = Record<string, unknown>;

/** Lee `empresa.sitioWeb` dentro de un objeto anidado. Nunca lanza. */
export function valorEnRuta(objeto: unknown, ruta: string): unknown {
  const partes = ruta.split(".");
  let actual: unknown = objeto;
  for (const parte of partes) {
    if (actual === null || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

export function escribirEnRuta(objeto: Borrador, ruta: string, valor: unknown): Borrador {
  const partes = ruta.split(".");
  const copia: Borrador = { ...objeto };
  let nivel: Borrador = copia;
  for (let i = 0; i < partes.length - 1; i++) {
    const clave = partes[i]!;
    const hijo = nivel[clave];
    const siguiente: Borrador =
      hijo !== null && typeof hijo === "object" && !Array.isArray(hijo)
        ? { ...(hijo as Borrador) }
        : {};
    nivel[clave] = siguiente;
    nivel = siguiente;
  }
  nivel[partes[partes.length - 1]!] = valor;
  return copia;
}

/**
 * Un dato cuenta como sabido si tiene contenido. Cadena vacía, lista vacía y
 * `null` NO cuentan: si contaran, una respuesta en blanco silenciaría la
 * pregunta para siempre y el agente saldría a producción con un hueco.
 */
export function estaResuelto(valor: unknown): boolean {
  if (valor === undefined || valor === null) return false;
  if (typeof valor === "string") return valor.trim().length > 0;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") return Object.keys(valor as object).length > 0;
  return true;
}

/**
 * Mezcla parcial: lo que llega gana, lo que no llega se conserva.
 *
 * Los objetos se funden en profundidad y las listas se REEMPLAZAN. Fundir
 * listas parecería más generoso, pero haría imposible quitar un elemento:
 * «ya no quiero que pida el presupuesto» tiene que poder ejecutarse.
 */
export function fusionar(base: unknown, parcial: unknown): unknown {
  if (parcial === undefined) return base;
  if (parcial === null) return null;
  if (Array.isArray(parcial)) return [...parcial];
  if (typeof parcial !== "object") return parcial;

  const salida: Borrador =
    base !== null && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Borrador) }
      : {};
  for (const [clave, valor] of Object.entries(parcial as Borrador)) {
    if (valor === undefined) continue;
    salida[clave] = fusionar(salida[clave], valor);
  }
  return salida;
}

export class BorradorInvalidoError extends Error {
  constructor(readonly detalles: readonly string[]) {
    super(`El borrador no es válido: ${detalles.join("; ")}.`);
    this.name = "BorradorInvalidoError";
  }
}

/**
 * Funde el parcial sobre el borrador y valida el resultado contra el esquema
 * de la capacidad. Se valida DESPUÉS de fundir, no antes: un parcial casi
 * siempre está incompleto por definición, y lo que tiene que ser coherente es
 * el borrador entero.
 */
export function fusionarBorrador(
  esquema: ZodType<unknown>,
  actual: Borrador,
  parcial: Borrador,
): Borrador {
  const fundido = fusionar(actual, parcial) as Borrador;
  const resultado = esquema.safeParse(fundido);
  if (!resultado.success) {
    throw new BorradorInvalidoError(
      resultado.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`),
    );
  }
  return resultado.data as Borrador;
}

/** Una pregunta ya lista para renderizarse como opciones. */
export type PreguntaPendiente = {
  readonly key: string;
  readonly prompt: string;
  readonly options?: readonly { value: string; label: string; hint?: string }[];
  readonly multiple?: boolean;
  readonly allowFreeText?: boolean;
};

export type EntradaPendientes = {
  readonly capacidad: CapabilityDef;
  readonly fase: FaseMeta;
  readonly borrador: Borrador;
  /**
   * Datos que ya existen fuera del borrador —la ficha de empresa, sobre todo—
   * en forma de rutas resueltas. Lo que esté aquí tampoco se pregunta.
   */
  readonly yaSabido?: readonly string[];
  readonly maximo?: number;
};

/**
 * Las preguntas que faltan de esta fase, como mucho tres.
 *
 * Se descarta una pregunta por tres motivos distintos, y los tres importan:
 * el dato ya está en el borrador, el dato ya está en el contexto de la
 * empresa, o la propia capacidad declara que en este caso no aplica.
 */
export function preguntasPendientes(entrada: EntradaPendientes): readonly PreguntaPendiente[] {
  const fase = entrada.capacidad.phases.find((f) => f.slug === entrada.fase);
  if (!fase) return [];
  const sabidas = new Set(entrada.yaSabido ?? []);
  const tope = entrada.maximo ?? MAXIMO_PREGUNTAS_POR_RONDA;

  const pendientes: PreguntaPendiente[] = [];
  for (const pregunta of fase.questions) {
    if (pendientes.length >= tope) break;
    if (yaRespondida(pregunta, entrada.borrador, sabidas)) continue;
    pendientes.push(aPendiente(pregunta));
  }
  return pendientes;
}

/** Todas las preguntas de la fase que siguen sin respuesta, sin tope. */
export function huecosDeLaFase(entrada: EntradaPendientes): readonly string[] {
  const fase = entrada.capacidad.phases.find((f) => f.slug === entrada.fase);
  if (!fase) return [];
  const sabidas = new Set(entrada.yaSabido ?? []);
  return fase.questions
    .filter((p) => !yaRespondida(p, entrada.borrador, sabidas))
    .map((p) => p.key);
}

/** True cuando la fase no tiene ya nada que preguntar y puede avanzar. */
export function faseCompleta(entrada: EntradaPendientes): boolean {
  return huecosDeLaFase(entrada).length === 0;
}

function yaRespondida(
  pregunta: CapabilityQuestion,
  borrador: Borrador,
  sabidas: ReadonlySet<string>,
): boolean {
  if (sabidas.has(pregunta.key)) return true;
  if (estaResuelto(valorEnRuta(borrador, pregunta.key))) return true;
  if (pregunta.skipIfPresent?.(borrador) === true) return true;
  return false;
}

function aPendiente(pregunta: CapabilityQuestion): PreguntaPendiente {
  return {
    key: pregunta.key,
    prompt: pregunta.prompt,
    ...(pregunta.options ? { options: pregunta.options } : {}),
    ...(pregunta.multiple === true ? { multiple: true } : {}),
    ...(pregunta.allowFreeText === true ? { allowFreeText: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Claves: la red de seguridad
// ---------------------------------------------------------------------------

/**
 * Todas las rutas que una capacidad conoce, en notación de punto.
 *
 * Salen del ESQUEMA del borrador, no de las preguntas: hay campos que ninguna
 * pregunta cubre —`hace`, `noHace`, `escalar`— y que el meta-agente escribe y
 * puede necesitar preguntar. Derivarlas del esquema significa además que
 * añadir un campo al borrador lo hace preguntable sin tocar nada más.
 */
export function rutasConocidas(capacidad: CapabilityDef): readonly string[] {
  const rutas = new Set<string>(rutasDelEsquema(capacidad.draftSchema));
  for (const fase of capacidad.phases) {
    for (const pregunta of fase.questions) rutas.add(pregunta.key);
  }
  return [...rutas];
}

/**
 * Las rutas de un esquema Zod, hasta dos niveles.
 *
 * Dos niveles es lo que hay y lo que debe haber: un borrador con tres niveles
 * de anidamiento no lo rellena bien ningún modelo, y tampoco lo edita bien
 * ninguna persona en un checklist.
 */
function rutasDelEsquema(esquema: unknown, prefijo = "", profundidad = 0): string[] {
  const forma = formaDeObjeto(esquema);
  if (!forma) return [];

  const rutas: string[] = [];
  for (const [clave, valor] of Object.entries(forma)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    rutas.push(ruta);
    if (profundidad < 1) rutas.push(...rutasDelEsquema(valor, ruta, profundidad + 1));
  }
  return rutas;
}

/** Desenvuelve `.optional()`, `.default()` y compañía hasta dar con el objeto. */
function formaDeObjeto(esquema: unknown): Record<string, unknown> | null {
  let actual = esquema;
  for (let i = 0; i < 6; i++) {
    if (actual === null || typeof actual !== "object") return null;
    const def = (actual as { _def?: { type?: string; shape?: unknown; innerType?: unknown } })._def;
    const forma = (actual as { shape?: unknown }).shape;
    if (forma && typeof forma === "object") return forma as Record<string, unknown>;
    const interno = def?.innerType;
    if (!interno) return null;
    actual = interno;
  }
  return null;
}

/**
 * Normaliza la clave que escribió el modelo.
 *
 * Los modelos económicos escriben `agente_nombre` en vez de `agente.nombre`
 * con una regularidad deprimente. Traducirlo cuesta una línea y ahorra un
 * turno entero de corrección que la persona lee como un tartamudeo. Lo que NO
 * se hace es adivinar: si después de normalizar la clave sigue sin existir, se
 * devuelve `null` y quien llama decide —normalmente, rechazar con un mensaje
 * que el modelo pueda corregir en el mismo turno.
 */
export function normalizarClave(
  clave: string,
  capacidad: CapabilityDef,
): string | null {
  const rutas = rutasConocidas(capacidad);
  const limpia = clave.trim();
  if (rutas.includes(limpia)) return limpia;

  const conPuntos = limpia.replace(/_/g, ".");
  if (rutas.includes(conPuntos)) return conPuntos;

  // `nombre_del_agente` → la ruta que termina en `.nombre` es la única
  // candidata razonable; con dos candidatas no se adivina.
  const cola = limpia.split(/[._]/).pop() ?? "";
  const candidatas = rutas.filter((r) => r === cola || r.endsWith(`.${cola}`));
  return candidatas.length === 1 ? candidatas[0]! : null;
}

/**
 * Endereza un parcial antes de fundirlo.
 *
 * `{"agente_nombre": "Espiga"}` se convierte en `{"agente": {"nombre": …}}`.
 * Lo que no se puede enderezar se rechaza con la lista de rutas válidas, que
 * es un mensaje que el modelo puede corregir en el mismo turno; el esquema, en
 * cambio, solo sabe decir «entrada inválida».
 */
export function normalizarParcial(
  parcial: Borrador,
  capacidad: CapabilityDef,
): Borrador {
  const rutas = rutasConocidas(capacidad);
  let salida: Borrador = {};
  const rechazadas: string[] = [];

  for (const [clave, valor] of Object.entries(parcial)) {
    if (rutas.includes(clave)) {
      salida[clave] = valor;
      continue;
    }
    const enderezada = normalizarClave(clave, capacidad);
    if (enderezada === null) {
      rechazadas.push(clave);
      continue;
    }
    salida = escribirEnRuta(salida, enderezada, valor);
  }

  if (rechazadas.length > 0) {
    throw new BorradorInvalidoError([
      `estas claves no existen: ${rechazadas.join(", ")}. Las válidas son: ${rutas.join(", ")}`,
    ]);
  }
  return salida;
}
