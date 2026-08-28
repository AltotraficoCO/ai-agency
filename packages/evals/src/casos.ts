/**
 * Casos guardados y diff entre versiones.
 *
 * Cualquier conversación real se convierte en caso con un clic
 * (`eval_cases.source_conversation_id`). Al publicar una versión nueva se
 * corren todos y se enseña el diff contra la anterior: «4 mejoran, 1 empeora».
 * Esto es lo que permite editar un prompt sin miedo.
 */
import { formatearTranscripto, type MensajeTranscrito, MARCA_FIN, MARCA_INICIO } from "@strappy/analysis";
import type { JuezPort } from "./juez.js";
import type { AgenteBajoPruebaPort, TurnoDePrueba, Veredicto } from "./tipos.js";

export type EsperadoDeCaso = {
  readonly debeContener?: readonly string[];
  readonly noDebeContener?: readonly string[];
  readonly objetivoLogrado?: boolean;
  /** Qué se espera, en una frase. Es lo que lee el juez con modelo. */
  readonly nota?: string;
};

export type CasoDeEvaluacion = {
  readonly id: string;
  readonly nombre: string;
  readonly agentId?: string;
  /** Lo que dice el contacto, turno a turno. */
  readonly turnos: readonly string[];
  readonly esperado?: EsperadoDeCaso;
  readonly etiquetas?: readonly string[];
  readonly sourceConversationId?: string;
  readonly activo?: boolean;
};

export interface CasosPort {
  listar(input: { workspaceId: string; agentId: string }): Promise<readonly CasoDeEvaluacion[]>;
  guardar(caso: CasoDeEvaluacion & { workspaceId: string }): Promise<{ id: string }>;
  /** Última corrida de una versión, para poder comparar sin recalcularla. */
  ultimaCorrida?(input: { workspaceId: string; agentId: string; versionId: string }): Promise<CorridaDeCasos | null>;
  guardarCorrida?(corrida: CorridaDeCasos & { workspaceId: string; agentId: string }): Promise<void>;
}

/** Un clic: conversación real → caso de regresión. */
export function casoDesdeConversacion(input: {
  readonly conversationId: string;
  readonly nombre?: string;
  readonly mensajes: readonly MensajeTranscrito[];
  readonly esperado?: EsperadoDeCaso;
  readonly etiquetas?: readonly string[];
}): CasoDeEvaluacion {
  const turnos = input.mensajes.filter((m) => m.rol === "contacto").map((m) => m.texto.trim()).filter((t) => t.length > 0);
  return {
    id: `caso_${input.conversationId}`,
    nombre: input.nombre ?? `Conversación ${input.conversationId}`,
    turnos,
    sourceConversationId: input.conversationId,
    activo: true,
    ...(input.esperado ? { esperado: input.esperado } : {}),
    ...(input.etiquetas ? { etiquetas: input.etiquetas } : {}),
  };
}

export type ResultadoDeCaso = {
  readonly casoId: string;
  readonly nombre: string;
  readonly veredicto: Veredicto;
  readonly transcripto: string;
  readonly latenciaMaxMs: number;
};

export type CorridaDeCasos = {
  readonly versionId: string;
  readonly resultados: readonly ResultadoDeCaso[];
  readonly puntuacionMedia: number;
  readonly aprobados: number;
  readonly total: number;
  readonly corridaEl: Date;
};

export type DepsCasos = {
  readonly agente: AgenteBajoPruebaPort;
  readonly juez: JuezPort;
  readonly now?: () => Date;
};

export async function correrCasos(
  deps: DepsCasos,
  input: {
    readonly casos: readonly CasoDeEvaluacion[];
    readonly versionId: string;
    readonly objetivo?: string;
  },
): Promise<CorridaDeCasos> {
  const now = deps.now ?? (() => new Date());
  const resultados: ResultadoDeCaso[] = [];

  for (const caso of input.casos) {
    if (caso.activo === false) continue;
    const turnos: TurnoDePrueba[] = [];
    let latencia = 0;
    for (const mensaje of caso.turnos) {
      const historial = [...turnos];
      turnos.push({ rol: "contacto", texto: mensaje });
      const r = await deps.agente.responder({ historial, mensaje });
      turnos.push({ rol: "agente", texto: r.texto });
      latencia = Math.max(latencia, r.latenciaMs);
    }
    const transcripto = formatearTranscripto(
      turnos.map((t, i) => ({
        rol: t.rol === "contacto" ? "contacto" : "agente",
        texto: t.texto,
        enviadoEl: new Date(i * 1000),
      })),
    );
    const veredicto = await deps.juez.juzgar({
      caso,
      transcripto,
      ...(input.objetivo ? { objetivo: input.objetivo } : {}),
    });
    resultados.push({ casoId: caso.id, nombre: caso.nombre, veredicto, transcripto, latenciaMaxMs: latencia });
  }

  const total = resultados.length;
  const suma = resultados.reduce((s, r) => s + r.veredicto.puntuacion, 0);
  return {
    versionId: input.versionId,
    resultados,
    total,
    aprobados: resultados.filter((r) => r.veredicto.aprobado).length,
    puntuacionMedia: total === 0 ? 0 : Math.round(suma / total),
    corridaEl: now(),
  };
}

/** Diferencia menor que esto es ruido del juez, no una mejora. */
export const UMBRAL_DE_CAMBIO = 5;

export type CambioDeCaso = {
  readonly casoId: string;
  readonly nombre: string;
  readonly antes: number | null;
  readonly ahora: number;
  readonly delta: number;
  readonly sentido: "mejora" | "empeora" | "igual" | "nuevo";
};

export type DiffDeCorridas = {
  readonly mejoran: number;
  readonly empeoran: number;
  readonly iguales: number;
  readonly nuevos: number;
  readonly deltaMedio: number;
  /** Hay al menos un caso que empeora. Es la señal que frena una publicación. */
  readonly hayRegresion: boolean;
  readonly cambios: readonly CambioDeCaso[];
  /** «4 mejoran, 1 empeora». Listo para enseñar tal cual. */
  readonly resumen: string;
};

export function compararCorridas(
  anterior: CorridaDeCasos | null,
  nueva: CorridaDeCasos,
  umbral: number = UMBRAL_DE_CAMBIO,
): DiffDeCorridas {
  const previos = new Map((anterior?.resultados ?? []).map((r) => [r.casoId, r.veredicto.puntuacion]));
  const cambios: CambioDeCaso[] = nueva.resultados.map((r) => {
    const antes = previos.get(r.casoId);
    const ahora = r.veredicto.puntuacion;
    if (antes === undefined) {
      return { casoId: r.casoId, nombre: r.nombre, antes: null, ahora, delta: 0, sentido: "nuevo" as const };
    }
    const delta = ahora - antes;
    const sentido = delta >= umbral ? "mejora" : delta <= -umbral ? "empeora" : "igual";
    return { casoId: r.casoId, nombre: r.nombre, antes, ahora, delta, sentido };
  });

  const cuenta = (s: CambioDeCaso["sentido"]) => cambios.filter((c) => c.sentido === s).length;
  const conPrevio = cambios.filter((c) => c.antes !== null);
  const deltaMedio =
    conPrevio.length === 0 ? 0 : Math.round(conPrevio.reduce((s, c) => s + c.delta, 0) / conPrevio.length);

  const mejoran = cuenta("mejora");
  const empeoran = cuenta("empeora");
  return {
    mejoran,
    empeoran,
    iguales: cuenta("igual"),
    nuevos: cuenta("nuevo"),
    deltaMedio,
    hayRegresion: empeoran > 0,
    cambios,
    resumen: redactarDiff(mejoran, empeoran, cuenta("igual"), cuenta("nuevo")),
  };
}

function redactarDiff(mejoran: number, empeoran: number, iguales: number, nuevos: number): string {
  const partes: string[] = [];
  if (mejoran > 0) partes.push(`${mejoran} ${mejoran === 1 ? "mejora" : "mejoran"}`);
  if (empeoran > 0) partes.push(`${empeoran} ${empeoran === 1 ? "empeora" : "empeoran"}`);
  if (iguales > 0) partes.push(`${iguales} sin cambio`);
  if (nuevos > 0) partes.push(`${nuevos} ${nuevos === 1 ? "caso nuevo" : "casos nuevos"}`);
  return partes.length === 0 ? "sin casos" : partes.join(", ");
}

export { MARCA_FIN, MARCA_INICIO };
