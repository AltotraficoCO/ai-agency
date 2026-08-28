/**
 * Recuperación.
 *
 * Dos decisiones cargan casi todo el valor de este archivo:
 *
 *  1. La consulta se compone con los DOS últimos turnos del usuario. "¿Y eso
 *     cuánto vale?" no tiene ni un sustantivo buscable; con el turno anterior
 *     ("¿tienen la silla ergonómica azul?") sí lo tiene. Es el fallo más común
 *     en WhatsApp y sale gratis arreglarlo.
 *  2. Tope de 800 ms con degradación elegante. Si el conocimiento no responde,
 *     el turno sigue sin él. Un agente que responde sin el catálogo es peor que
 *     uno que lo tiene; uno que deja a la persona esperando en visto es mucho
 *     peor que los dos.
 */
import type { ConocimientoDbPort, EmbeddingsPort, RegistroPort } from "./ports.js";
import {
  AJUSTES_POR_DEFECTO,
  TROZOS_POR_AMPLITUD,
  UMBRALES,
  type AjustesRecuperacion,
  type FilaBusqueda,
  type FragmentoRecuperado,
  type IdCerebro,
} from "./types.js";

export const TIMEOUT_MS = 800;

/** Longitud máxima de la consulta compuesta. Más allá el vector se difumina. */
const MAXIMO_CARACTERES_CONSULTA = 400;

/**
 * Compone la consulta a partir del historial de turnos del usuario.
 *
 * Se toman los dos últimos, el más reciente primero: el peso del embedding va
 * al principio, y el turno anterior actúa de contexto. Si el último turno ya
 * es largo y autosuficiente, el anterior aporta poco pero tampoco estorba.
 */
export function componerConsulta(turnosUsuario: readonly string[]): string {
  const limpios = turnosUsuario
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t !== "");
  if (limpios.length === 0) return "";

  const ultimo = limpios[limpios.length - 1] ?? "";
  const anterior = limpios[limpios.length - 2];

  // Repetir el mismo texto dos veces no aporta y sí sesga el vector.
  const partes =
    anterior !== undefined && anterior.toLowerCase() !== ultimo.toLowerCase()
      ? [ultimo, anterior]
      : [ultimo];

  let consulta = partes.join(" · ");
  if (consulta.length > MAXIMO_CARACTERES_CONSULTA) {
    // Se recorta por el final, que es el turno más antiguo: es el prescindible.
    consulta = consulta.slice(0, MAXIMO_CARACTERES_CONSULTA).replace(/\s+\S*$/, "");
  }
  return consulta;
}

/**
 * Palabras vacías del castellano. No se pretende que sea exhaustiva: Postgres
 * ya las quita al construir el tsvector. Se filtran aquí solo para no gastar
 * los términos del `or`.
 */
const VACIAS = new Set([
  "que", "cual", "cuales", "como", "donde", "cuando", "quien", "por", "para", "con", "sin",
  "los", "las", "del", "una", "unos", "unas", "pero", "esta", "este", "esto", "esos", "esas",
  "hay", "son", "eso", "esa", "ese", "mas", "muy", "sus", "les", "nos", "yo", "tu", "el", "la",
  "de", "en", "un", "es", "al", "lo", "se", "su", "me", "te", "ya", "and", "or", "the",
]);

/**
 * Consulta para la parte léxica de `search_knowledge`.
 *
 * `websearch_to_tsquery` une los términos con AND: "cuanto cuesta el plan pro"
 * se convierte en 'cuant & cuest & plan & pro' y no encuentra NADA salvo que el
 * trozo repita la pregunta entera. Con eso la mitad léxica de la búsqueda
 * híbrida no se dispara nunca y se pierde justo lo que existe para rescatar:
 * referencias, códigos y precios literales. Reescribir la pregunta como `or`
 * de sus términos con contenido devuelve la mitad léxica a la vida sin tocar
 * la función SQL.
 */
export function consultaLexica(texto: string): string {
  const terminos = texto
    .toLowerCase()
    .replace(/[«»"“”'`´()[\]{}¿?¡!,;:.…·|]/g, " ")
    .split(/\s+/)
    // Un guion inicial es NOT en la sintaxis de websearch: se quita siempre.
    .map((t) => t.replace(/^-+|-+$/g, "").trim())
    .filter((t) => t !== "" && !VACIAS.has(t) && (t.length > 2 || /\d/.test(t)));
  return [...new Set(terminos)].slice(0, 12).join(" or ");
}

export type ResultadoRecuperacion = {
  readonly consulta: string;
  readonly fragmentos: readonly FragmentoRecuperado[];
  readonly candidatos: readonly (FilaBusqueda & { usado: boolean; motivo: string })[];
  /** True si se agotó el tiempo o falló algo: el turno sigue sin conocimiento. */
  readonly degradado: boolean;
  readonly milisegundos: number;
};

/**
 * Aplica el umbral de exigencia sobre el resultado ya fusionado por RRF.
 *
 * El corte es relativo al mejor resultado, no absoluto: la escala de RRF no
 * significa nada por sí sola, pero "esto puntúa un tercio de lo que puntúa el
 * mejor" sí separa lo pertinente de lo que salió por rellenar.
 */
export function aplicarUmbral(
  filas: readonly FilaBusqueda[],
  ajustes: AjustesRecuperacion,
  limite: number,
): readonly (FilaBusqueda & { usado: boolean; motivo: string })[] {
  if (filas.length === 0) return [];
  const umbral = UMBRALES[ajustes.exigencia];
  const mejor = Math.max(...filas.map((f) => f.puntuacion));
  const minimo = mejor * umbral.fraccionDelMejor;

  let admitidos = 0;
  return filas.map((fila) => {
    if (fila.puntuacion < minimo) {
      return { ...fila, usado: false, motivo: "puntúa muy por debajo del mejor resultado" };
    }
    // La distancia solo existe si el trozo salió por la vía semántica. Un
    // acierto puramente literal (una referencia, un precio) no se descarta por
    // no tener distancia: es justo el caso que la parte léxica existe para
    // rescatar.
    if (
      umbral.distanciaMaxima !== null &&
      fila.distancia !== null &&
      fila.distancia > umbral.distanciaMaxima
    ) {
      return { ...fila, usado: false, motivo: "se parece poco a la pregunta" };
    }
    if (admitidos >= limite) {
      return { ...fila, usado: false, motivo: "cabe fuera del número de fragmentos pedido" };
    }
    admitidos += 1;
    const via =
      fila.rangoVectorial !== null && fila.rangoLexico !== null
        ? "coincide por significado y por palabras"
        : fila.rangoVectorial !== null
          ? "coincide por significado"
          : "coincide por palabras exactas";
    return { ...fila, usado: true, motivo: via };
  });
}

/** Ejecuta una promesa con tope de tiempo. Al vencer NO se lanza: se degrada. */
async function conTope<T>(
  tarea: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<{ ok: true; valor: T } | { ok: false; motivo: string }> {
  const control = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<{ ok: false; motivo: string }>((resolve) => {
    temporizador = setTimeout(() => {
      control.abort();
      resolve({ ok: false, motivo: `tiempo agotado (${ms} ms)` });
    }, ms);
  });
  try {
    return await Promise.race([
      tarea(control.signal).then((valor) => ({ ok: true as const, valor })),
      vencimiento,
    ]);
  } catch (error) {
    return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

export type DepsRecuperacion = {
  readonly db: ConocimientoDbPort;
  readonly embeddings: EmbeddingsPort;
  readonly registro?: RegistroPort;
  readonly timeoutMs?: number;
  readonly ahora?: () => number;
};

export async function recuperar(
  deps: DepsRecuperacion,
  input: {
    workspaceId: string;
    cerebroIds: readonly IdCerebro[];
    /** Turnos del usuario, del más antiguo al más reciente. */
    turnosUsuario: readonly string[];
    ajustes?: AjustesRecuperacion;
    /** Fuerza el número de fragmentos, ignorando la amplitud. */
    limite?: number;
  },
): Promise<ResultadoRecuperacion> {
  const ajustes = input.ajustes ?? AJUSTES_POR_DEFECTO;
  const limite = input.limite ?? TROZOS_POR_AMPLITUD[ajustes.amplitud];
  const consulta = componerConsulta(input.turnosUsuario);
  const reloj = deps.ahora ?? ((): number => Date.now());
  const inicio = reloj();

  if (consulta === "" || input.cerebroIds.length === 0) {
    return { consulta, fragmentos: [], candidatos: [], degradado: false, milisegundos: 0 };
  }

  const timeout = deps.timeoutMs ?? TIMEOUT_MS;
  // Embedding y búsqueda comparten el mismo tope: al motor le da igual dónde
  // se fue el tiempo, lo que no puede es esperar más de 800 ms en total.
  const resultado = await conTope(async (signal) => {
    const [embedding] = await deps.embeddings.incrustar([consulta]);
    if (!embedding) throw new Error("el proveedor no devolvió ningún vector");
    // Se piden más filas de las que se van a usar: el umbral descarta, y sin
    // margen una sola fila floja dejaría la respuesta sin contexto.
    const filas = await deps.db.buscar({
      workspaceId: input.workspaceId,
      cerebroIds: input.cerebroIds,
      consulta: consultaLexica(consulta),
      embedding,
      k: Math.max(limite * 2, 8),
      signal,
    });
    return filas;
  }, timeout);

  const milisegundos = reloj() - inicio;

  if (!resultado.ok) {
    deps.registro?.aviso("conocimiento.degradado", {
      motivo: resultado.motivo,
      milisegundos,
      consulta,
    });
    return { consulta, fragmentos: [], candidatos: [], degradado: true, milisegundos };
  }

  const candidatos = aplicarUmbral(resultado.valor, ajustes, limite);
  const usados = candidatos.filter((c) => c.usado);
  const fuentes = await citarFuentes(deps.db, input.workspaceId, usados);

  return {
    consulta,
    fragmentos: usados.map((c) => {
      const cita = fuentes.get(c.sourceId);
      const titulo =
        cita?.titulo ??
        (typeof c.metadata["titulo"] === "string" ? (c.metadata["titulo"] as string) : "Documento");
      const uri =
        cita?.uri ?? (typeof c.metadata["uri"] === "string" ? (c.metadata["uri"] as string) : null);
      return {
        title: titulo,
        text: c.contenido,
        ...(uri ? { source: uri } : {}),
        score: c.puntuacion,
      };
    }),
    candidatos,
    degradado: false,
    milisegundos,
  };
}

/**
 * Trae título y URL de las fuentes citadas. Si falla, no se pierde el
 * resultado: se cita con lo que venga en la metadata del trozo.
 */
async function citarFuentes(
  db: ConocimientoDbPort,
  workspaceId: string,
  filas: readonly FilaBusqueda[],
): Promise<ReadonlyMap<string, { titulo: string; uri: string | null }>> {
  const ids = [...new Set(filas.map((f) => f.sourceId))];
  if (ids.length === 0) return new Map();
  try {
    return await db.fuentesPorId({ workspaceId, ids });
  } catch {
    return new Map();
  }
}
