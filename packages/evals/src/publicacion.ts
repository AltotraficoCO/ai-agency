/**
 * La puerta de publicación.
 *
 * Junta los dos primeros niveles: el humo obligatorio (siempre) y los casos
 * guardados con su diff (si los hay). Una sola función porque la decisión es
 * una sola: se publica o no se publica.
 */
import { correrSmoke, type DepsSmoke, type EntradaSmoke, type ResultadoSmoke } from "./smoke.js";
import {
  compararCorridas,
  correrCasos,
  type CasoDeEvaluacion,
  type CorridaDeCasos,
  type DepsCasos,
  type DiffDeCorridas,
} from "./casos.js";

export type DepsPublicacion = DepsSmoke & Partial<DepsCasos>;

export type EntradaPublicacion = {
  readonly agentId: string;
  readonly workspaceId: string;
  /** Versión que se pretende publicar. Aún es un borrador. */
  readonly versionId: string;
  readonly smoke?: EntradaSmoke;
  readonly casos?: readonly CasoDeEvaluacion[];
  readonly corridaAnterior?: CorridaDeCasos | null;
  /**
   * Si una regresión en los casos guardados frena la publicación.
   * Por defecto NO: el juez se equivoca y el dueño del agente decide. La
   * inyección, en cambio, no se negocia.
   */
  readonly bloquearPorRegresion?: boolean;
};

export type DecisionDePublicacion = {
  readonly permitida: boolean;
  readonly motivo: string;
  readonly smoke: ResultadoSmoke;
  readonly corrida?: CorridaDeCasos;
  readonly diff?: DiffDeCorridas;
};

export async function evaluarPublicacion(
  deps: DepsPublicacion,
  input: EntradaPublicacion,
): Promise<DecisionDePublicacion> {
  const smoke = await correrSmoke(deps, input.smoke ?? {});
  if (smoke.bloqueaPublicacion) {
    const fallos = smoke.chequeos.filter((c) => c.bloqueante && !c.paso);
    return {
      permitida: false,
      motivo: `Publicación bloqueada: ${fallos.map((f) => `${f.etiqueta} — ${f.detalle}`).join(" | ")}`,
      smoke,
    };
  }

  const casos = input.casos ?? [];
  if (casos.length === 0 || !deps.juez) {
    return {
      permitida: true,
      motivo: smoke.aprobado ? "El humo pasa." : "El humo pasa lo bloqueante; hay avisos no bloqueantes.",
      smoke,
    };
  }

  const corrida = await correrCasos(
    { agente: deps.agente, juez: deps.juez, ...(deps.now ? { now: () => new Date(deps.now!()) } : {}) },
    {
      casos,
      versionId: input.versionId,
      ...(input.smoke?.objetivo ? { objetivo: input.smoke.objetivo } : {}),
    },
  );
  const diff = compararCorridas(input.corridaAnterior ?? null, corrida);

  if (input.bloquearPorRegresion && diff.hayRegresion) {
    return { permitida: false, motivo: `Hay regresión en los casos guardados: ${diff.resumen}.`, smoke, corrida, diff };
  }
  return { permitida: true, motivo: `El humo pasa. Casos: ${diff.resumen}.`, smoke, corrida, diff };
}
