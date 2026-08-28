/**
 * Verificación de calidad tras ingerir.
 *
 * Sin esto, un Cerebro que no recupera nada útil es invisible: el cliente ve
 * "47 pedacitos de información listos", el agente responde mal, y nadie sabe
 * por qué. Se generan 5 preguntas a partir del propio contenido y se comprueba
 * que la búsqueda devuelve los trozos de los que salieron. Por debajo del 80%
 * de acierto, la fuente se marca «conviene revisar».
 */
import type {
  ConocimientoDbPort,
  EmbeddingsPort,
  GeneradorPreguntasPort,
  RegistroPort,
} from "./ports.js";
import { recuperar } from "./recuperar.js";
import { formatearRuta } from "./trocear.js";
import { dividirEnFrases } from "./texto.js";
import type { AjustesRecuperacion, DocumentoCrudo, IdCerebro, Trozo } from "./types.js";

export const PREGUNTAS_DE_PRUEBA = 5;
export const ACIERTO_MINIMO = 0.8;

export type ResultadoVerificacion = {
  readonly preguntas: readonly { pregunta: string; acertada: boolean }[];
  readonly acierto: number;
  readonly aprobado: boolean;
  readonly aviso?: string;
};

/**
 * Preguntas heurísticas cuando no hay un modelo detrás.
 *
 * Toma los trozos más separados entre sí (no los cinco primeros: eso solo
 * probaría la primera página) y arma una pregunta con su ruta de encabezados y
 * su primera frase con contenido. No es una pregunta bonita, pero para medir
 * si el trozo es recuperable sirve exactamente igual.
 */
export function preguntasHeuristicas(trozos: readonly Trozo[], cuantas: number): string[] {
  if (trozos.length === 0) return [];
  const paso = Math.max(1, Math.floor(trozos.length / cuantas));
  const elegidos: Trozo[] = [];
  for (let i = 0; i < trozos.length && elegidos.length < cuantas; i += paso) {
    const t = trozos[i];
    if (t) elegidos.push(t);
  }

  return elegidos.map((t) => {
    const ruta = formatearRuta(t.rutaEncabezados);
    const frase = dividirEnFrases(t.texto.replace(/^#{1,6}\s+.*$/gm, "").replace(/\s+/g, " "))
      .map((f) => f.trim())
      .find((f) => f.length > 25 && f.length < 220);
    const nucleo = frase ?? t.texto.slice(0, 160);
    return ruta === "" ? `¿Qué dice sobre ${nucleo}?` : `${ruta}: ${nucleo}`;
  });
}

export type DepsVerificacion = {
  readonly db: ConocimientoDbPort;
  readonly embeddings: EmbeddingsPort;
  readonly generador?: GeneradorPreguntasPort;
  readonly registro?: RegistroPort;
  /** La verificación no compite con una conversación: puede tardar más. */
  readonly timeoutMs?: number;
};

export async function verificarFuente(
  deps: DepsVerificacion,
  input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    fuenteId: string;
    documento: DocumentoCrudo;
    trozos: readonly Trozo[];
    ajustes?: AjustesRecuperacion;
  },
): Promise<ResultadoVerificacion> {
  if (input.trozos.length === 0) {
    return { preguntas: [], acierto: 0, aprobado: false, aviso: "El documento no dejó contenido indexado." };
  }

  const preguntas = deps.generador
    ? await deps.generador.generar({
        documento: input.documento,
        trozos: input.trozos,
        cuantas: PREGUNTAS_DE_PRUEBA,
      })
    : preguntasHeuristicas(input.trozos, PREGUNTAS_DE_PRUEBA);

  if (preguntas.length === 0) {
    return { preguntas: [], acierto: 0, aprobado: false, aviso: "No se pudo generar ninguna pregunta de prueba." };
  }

  const resultados: { pregunta: string; acertada: boolean }[] = [];
  for (const pregunta of preguntas) {
    const r = await recuperar(
      {
        db: deps.db,
        embeddings: deps.embeddings,
        // La verificación corre en segundo plano, no dentro de un turno: aquí
        // degradar por 800 ms falsearía la medida.
        timeoutMs: deps.timeoutMs ?? 15_000,
        ...(deps.registro ? { registro: deps.registro } : {}),
      },
      {
        workspaceId: input.workspaceId,
        cerebroIds: [input.cerebroId],
        turnosUsuario: [pregunta],
        ...(input.ajustes ? { ajustes: input.ajustes } : {}),
        limite: 5,
      },
    );
    // Acierta si alguno de los fragmentos usados viene de ESTA fuente: la
    // pregunta salió de ella, así que si gana otro documento es que este no es
    // recuperable.
    const acertada =
      !r.degradado && r.candidatos.some((c) => c.usado && c.sourceId === input.fuenteId);
    resultados.push({ pregunta, acertada });
  }

  const acierto = resultados.filter((r) => r.acertada).length / resultados.length;
  const aprobado = acierto >= ACIERTO_MINIMO;

  if (!aprobado) {
    const aviso =
      `De ${resultados.length} preguntas de prueba, el agente solo encontró la respuesta en ` +
      `${resultados.filter((r) => r.acertada).length}. Conviene revisar este documento: ` +
      `puede estar mal estructurado o repetir contenido de otro.`;
    await deps.db.marcarEstadoFuente({
      workspaceId: input.workspaceId,
      fuenteId: input.fuenteId,
      estado: "stale",
      detalle: aviso,
      metadata: { revisar: true, motivo: "verificacion_baja", acierto },
    });
    deps.registro?.aviso("conocimiento.verificacion_baja", {
      fuenteId: input.fuenteId,
      acierto,
    });
    return { preguntas: resultados, acierto, aprobado, aviso };
  }

  return { preguntas: resultados, acierto, aprobado };
}
