import "server-only";

/**
 * El trabajo que un agente repite solo.
 *
 * «Cada mañana revisa qué vence», «todos los lunes mándame el informe». Esto no
 * ejecuta nada: guarda la cadencia. Cuando llega la hora, el worker crea un
 * encargo normal y lo hace el agente con sus aprobaciones y su cobro de siempre
 * (ver `apps/worker/src/consumers/programados.ts`).
 *
 * La hora que se guarda es la del RELOJ DEL CLIENTE, con su zona: «los lunes a
 * las 8» de un negocio colombiano no son las 8 del servidor.
 */
import {
  describirCadencia,
  esZonaValida,
  proximaEjecucion,
  vecesAlMes,
  type Cadencia,
  type Frecuencia,
} from "@strappy/core";
import { conEspacio } from "@/lib/db/pool";

export type MotivoPausa = "sin_creditos" | "agente_de_baja" | null;

export type ProgramadoVista = {
  id: string;
  titulo: string;
  detalle: string;
  /** «todos los días a las 08:00», ya en palabras. */
  cadencia: string;
  frecuencia: Frecuencia;
  activa: boolean;
  motivoPausa: MotivoPausa;
  /** ISO 8601. */
  proximaEn: string;
  ultimaEn: string | null;
  /** Para poder decirle al cliente cuánto va a gastar. */
  vecesAlMes: number;
};

export type ResultadoProgramado = { ok: true } | { ok: false; error: string };

/** Las frecuencias que el cliente puede elegir. */
export const FRECUENCIAS: readonly { valor: Frecuencia; etiqueta: string }[] = [
  { valor: "diaria", etiqueta: "Todos los días" },
  { valor: "semanal", etiqueta: "Una vez por semana" },
  { valor: "mensual", etiqueta: "Una vez al mes" },
];

/** Si la migración 0034 aún no está aplicada, la tabla no existe. */
function esTablaInexistente(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

export async function programadosDelAgente(
  workspaceId: string,
  agentId: string,
): Promise<ProgramadoVista[]> {
  return conEspacio(workspaceId, async (scope) => {
    try {
      const { rows } = await scope.query<{
        id: string;
        titulo: string;
        detalle: string;
        frecuencia: Frecuencia;
        hora: number;
        minuto: number;
        dia_semana: number | null;
        dia_mes: number | null;
        zona_horaria: string;
        activa: boolean;
        motivo_pausa: string | null;
        proxima_en: Date;
        ultima_en: Date | null;
      }>(
        `select id, titulo, detalle, frecuencia, hora, minuto, dia_semana, dia_mes,
                zona_horaria, activa, motivo_pausa, proxima_en, ultima_en
           from public.agent_schedules
          where workspace_id = $1 and agent_id = $2
          order by created_at`,
        [workspaceId, agentId],
      );
      return rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        detalle: r.detalle,
        cadencia: describirCadencia(cadenciaDe(r)),
        frecuencia: r.frecuencia,
        activa: r.activa,
        motivoPausa: (r.motivo_pausa as MotivoPausa) ?? null,
        proximaEn: new Date(r.proxima_en).toISOString(),
        ultimaEn: r.ultima_en ? new Date(r.ultima_en).toISOString() : null,
        vecesAlMes: vecesAlMes(r.frecuencia),
      }));
    } catch (error) {
      if (esTablaInexistente(error)) return [];
      throw error;
    }
  });
}

function cadenciaDe(r: {
  frecuencia: Frecuencia;
  hora: number;
  minuto: number;
  dia_semana: number | null;
  dia_mes: number | null;
  zona_horaria: string;
}): Cadencia {
  return {
    frecuencia: r.frecuencia,
    hora: r.hora,
    minuto: r.minuto,
    ...(r.dia_semana !== null ? { diaSemana: r.dia_semana } : {}),
    ...(r.dia_mes !== null ? { diaMes: r.dia_mes } : {}),
    zona: r.zona_horaria,
  };
}

/** Título corto para la lista: la primera frase del encargo. */
function tituloDe(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  const corte = limpio.slice(0, 70);
  return limpio.length > 70 ? `${corte.replace(/\s+\S*$/, "")}…` : corte;
}

export async function crearProgramado(input: {
  workspaceId: string;
  agentId: string;
  usuarioId: string;
  /** Slug del catálogo: quién lo ejecutará. */
  agente: string;
  texto: string;
  frecuencia: Frecuencia;
  hora: number;
  minuto: number;
  diaSemana?: number | undefined;
  diaMes?: number | undefined;
  zona: string;
}): Promise<ResultadoProgramado> {
  const texto = input.texto.trim();
  if (texto.length < 3) return { ok: false, error: "Escribe qué quieres que haga cada vez." };
  if (texto.length > 4000) {
    return { ok: false, error: "El encargo es demasiado largo. Divídelo en trabajos más pequeños." };
  }
  if (!Number.isInteger(input.hora) || input.hora < 0 || input.hora > 23) {
    return { ok: false, error: "La hora no es válida." };
  }
  // Sin zona válida no se puede prometer «a las 8 de la mañana»: mejor decirlo.
  const zona = esZonaValida(input.zona) ? input.zona : "America/Bogota";

  const cadencia: Cadencia = {
    frecuencia: input.frecuencia,
    hora: input.hora,
    minuto: input.minuto,
    ...(input.frecuencia === "semanal" ? { diaSemana: input.diaSemana ?? 1 } : {}),
    ...(input.frecuencia === "mensual" ? { diaMes: input.diaMes ?? 1 } : {}),
    zona,
  };

  const proxima = proximaEjecucion(new Date(), cadencia);

  return conEspacio(input.workspaceId, async (scope) => {
    try {
      await scope.query(
        `insert into public.agent_schedules
           (workspace_id, agent_id, agente, titulo, detalle, frecuencia, hora, minuto,
            dia_semana, dia_mes, zona_horaria, proxima_en, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          input.workspaceId,
          input.agentId,
          input.agente,
          tituloDe(texto),
          texto,
          cadencia.frecuencia,
          cadencia.hora,
          cadencia.minuto,
          cadencia.diaSemana ?? null,
          cadencia.diaMes ?? null,
          zona,
          proxima.toISOString(),
          input.usuarioId,
        ],
      );
      return { ok: true };
    } catch (error) {
      if (esTablaInexistente(error)) {
        return {
          ok: false,
          error: "El trabajo programado todavía no está disponible en este espacio.",
        };
      }
      throw error;
    }
  });
}

/**
 * Pausar y reanudar.
 *
 * Al reanudar se recalcula la próxima desde ahora: si estuvo parado un mes, lo
 * que toca es la siguiente vez, no las treinta que no se hicieron.
 */
export async function cambiarEstadoProgramado(input: {
  workspaceId: string;
  agentId: string;
  id: string;
  activa: boolean;
}): Promise<ResultadoProgramado> {
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      frecuencia: Frecuencia;
      hora: number;
      minuto: number;
      dia_semana: number | null;
      dia_mes: number | null;
      zona_horaria: string;
    }>(
      `select frecuencia, hora, minuto, dia_semana, dia_mes, zona_horaria
         from public.agent_schedules
        where workspace_id = $1 and agent_id = $2 and id = $3`,
      [input.workspaceId, input.agentId, input.id],
    );
    const fila = rows[0];
    if (!fila) return { ok: false, error: "Ese trabajo programado ya no existe." };

    const proxima = input.activa ? proximaEjecucion(new Date(), cadenciaDe(fila)) : null;
    await scope.query(
      `update public.agent_schedules
          set activa = $4,
              motivo_pausa = null,
              proxima_en = coalesce($5::timestamptz, proxima_en),
              updated_at = now()
        where workspace_id = $1 and agent_id = $2 and id = $3`,
      [input.workspaceId, input.agentId, input.id, input.activa, proxima?.toISOString() ?? null],
    );
    return { ok: true };
  });
}

export async function quitarProgramado(input: {
  workspaceId: string;
  agentId: string;
  id: string;
}): Promise<ResultadoProgramado> {
  return conEspacio(input.workspaceId, async (scope) => {
    await scope.query(
      `delete from public.agent_schedules
        where workspace_id = $1 and agent_id = $2 and id = $3`,
      [input.workspaceId, input.agentId, input.id],
    );
    return { ok: true };
  });
}
