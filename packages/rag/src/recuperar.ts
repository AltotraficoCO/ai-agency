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
import { explicacionDelModo, modoEfectivo, type ModoConocimiento } from "./modo.js";
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

/**
 * Tope cuando se busca por significado. Incluye vectorizar la pregunta en el
 * proveedor (una llamada de red), así que 800 ms dejaría la mitad semántica
 * degradándose a cada rato.
 */
export const TIMEOUT_COMPLETO_MS = 1500;

/** Tope del reintento solo por palabras cuando la búsqueda por significado falla. */
export const TIMEOUT_LEXICO_MS = 600;

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
  readonly modo: ModoConocimiento;
  /** Cómo buscó, en español llano. Alimenta el botón «Pruébalo». */
  readonly explicacion: string;
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
  modo: ModoConocimiento = "completo",
): readonly (FilaBusqueda & { usado: boolean; motivo: string })[] {
  if (filas.length === 0) return [];
  const umbral = UMBRALES[ajustes.exigencia];
  // En modo solo texto no existe distancia: no se buscó por significado. El
  // corte se hace por posición (el límite de fragmentos) y por la fuerza
  // relativa del `ts_rank`, que es lo que la fusión RRF ya ordenó. Aplicar
  // aquí un umbral de distancia sería descartarlo todo por no tener un dato
  // que en este modo no puede existir.
  const distanciaMaxima = modo === "solo-texto" ? null : umbral.distanciaMaxima;
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
      distanciaMaxima !== null &&
      fila.distancia !== null &&
      fila.distancia > distanciaMaxima
    ) {
      return { ...fila, usado: false, motivo: "se parece poco a la pregunta" };
    }
    if (admitidos >= limite) {
      return { ...fila, usado: false, motivo: "cabe fuera del número de fragmentos pedido" };
    }
    admitidos += 1;
    const via =
      modo === "solo-texto"
        ? "coincide por palabras exactas"
        : fila.rangoVectorial !== null && fila.rangoLexico !== null
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
  /** Ausente = modo solo texto: se busca con `qvec = null`. Ver `modo.ts`. */
  readonly embeddings?: EmbeddingsPort;
  readonly registro?: RegistroPort;
  readonly timeoutMs?: number;
  readonly ahora?: () => number;
  readonly forzarSoloTexto?: boolean;
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
  const modo = modoEfectivo({
    embeddings: deps.embeddings,
    ...(deps.forzarSoloTexto === undefined ? {} : { forzarSoloTexto: deps.forzarSoloTexto }),
  });
  const explicacion = explicacionDelModo(modo);

  if (consulta === "" || input.cerebroIds.length === 0) {
    return {
      consulta,
      fragmentos: [],
      candidatos: [],
      degradado: false,
      milisegundos: 0,
      modo,
      explicacion,
    };
  }

  const timeout = deps.timeoutMs ?? (modo === "completo" ? TIMEOUT_COMPLETO_MS : TIMEOUT_MS);
  // Embedding y búsqueda comparten el mismo tope: al motor le da igual dónde
  // se fue el tiempo, lo que no puede es esperar indefinidamente.
  const resultado = await conTope(async (signal) => {
    // En modo solo texto se manda `null` como vector: la rama vectorial de
    // `search_knowledge` lleva `and qvec is not null`, se queda vacía y la
    // fusión RRF devuelve solo los resultados léxicos. Sin SQL nuevo y sin
    // gastar una sola llamada de embedding.
    let embedding: readonly number[] | null = null;
    if (modo === "completo" && deps.embeddings) {
      const [vector] = await deps.embeddings.incrustar([consulta]);
      if (!vector) throw new Error("el proveedor no devolvió ningún vector");
      embedding = vector;
    }
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

  if (!resultado.ok) {
    deps.registro?.aviso("conocimiento.degradado", {
      motivo: resultado.motivo,
      milisegundos: reloj() - inicio,
      consulta,
    });

    // Con la búsqueda por significado encendida, lo que falló puede ser solo
    // esa mitad (el proveedor, el vector, su tiempo). La mitad por palabras no
    // depende de nada de eso: se intenta una vez antes de dejar al agente sin
    // conocimiento, que sería peor que no haber encendido nunca los vectores.
    if (modo === "completo") {
      const lexico = await conTope(
        (signal) =>
          deps.db.buscar({
            workspaceId: input.workspaceId,
            cerebroIds: input.cerebroIds,
            consulta: consultaLexica(consulta),
            embedding: null,
            k: Math.max(limite * 2, 8),
            signal,
          }),
        TIMEOUT_LEXICO_MS,
      );
      if (lexico.ok) {
        return armarResultado(deps, input.workspaceId, {
          consulta,
          filas: lexico.valor,
          ajustes,
          limite,
          modo: "solo-texto",
          degradado: true,
          milisegundos: reloj() - inicio,
        });
      }
    }

    return {
      consulta,
      fragmentos: [],
      candidatos: [],
      degradado: true,
      milisegundos: reloj() - inicio,
      modo,
      explicacion,
    };
  }

  return armarResultado(deps, input.workspaceId, {
    consulta,
    filas: resultado.valor,
    ajustes,
    limite,
    modo,
    degradado: false,
    milisegundos: reloj() - inicio,
  });
}

async function armarResultado(
  deps: DepsRecuperacion,
  workspaceId: string,
  datos: {
    consulta: string;
    filas: readonly FilaBusqueda[];
    ajustes: AjustesRecuperacion;
    limite: number;
    modo: ModoConocimiento;
    degradado: boolean;
    milisegundos: number;
  },
): Promise<ResultadoRecuperacion> {
  const { consulta, ajustes, limite, modo, degradado, milisegundos } = datos;
  const explicacion = explicacionDelModo(modo);
  const candidatos = aplicarUmbral(datos.filas, ajustes, limite, modo);
  const usados = candidatos.filter((c) => c.usado);
  const fuentes = await citarFuentes(deps.db, workspaceId, usados);

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
    degradado,
    milisegundos,
    modo,
    explicacion,
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
