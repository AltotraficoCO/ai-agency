import "server-only";

/**
 * Lectura del «Impacto» de los agentes del negocio.
 *
 * Solo cuenta encargos TERMINADOS (`agent_tasks.estado = 'done'`) de agentes
 * contratados que no atienden conversaciones (Webmaster, Marketing…): lo que
 * de verdad quitó trabajo de encima. Lo que el cálculo hace con ellos está en
 * `impacto-calculo.ts`, que es puro y está probado.
 *
 * Los pasos de trabajo (`agent_tasks.pasos`) llegan con una migración aparte y
 * puede que aún no existan: se leen con `to_jsonb(t)->'pasos'`, que devuelve
 * null sin romper si la columna no está. Para los encargos anteriores a esa
 * columna se usan las llamadas a herramientas guardadas en `mensajes`.
 */
import { conEspacio } from "@/lib/db/pool";
import { periodoAnterior, type RangoDias } from "./fechas";
import {
  leerAjustesImpacto,
  resumirImpacto,
  type AjustesImpacto,
  type EncargoParaImpacto,
  type ResumenImpacto,
} from "./impacto-calculo";

export type AgenteDelNegocio = {
  readonly id: string;
  readonly nombre: string;
  /** Slug del catálogo: `webmaster`, `marketing`… */
  readonly slug: string;
  readonly avatar: string | null;
};

export type ImpactoNegocio = ResumenImpacto & {
  readonly rango: RangoDias;
  readonly ajustes: AjustesImpacto;
  readonly agentes: readonly AgenteDelNegocio[];
  /** Encargos que todavía no terminaron (en cola, trabajando o esperando respuesta). */
  readonly enCurso: number;
  /** Encargos que fallaron en el periodo: no cuentan como ahorro. */
  readonly fallidos: number;
};

type FilaTarea = {
  id: string;
  agent_id: string | null;
  titulo: string;
  creditos: string;
  dia: string;
  terminado: Date;
  herramientas_pasos: string[] | null;
  herramientas_mensajes: string[] | null;
};

export async function impactoDelNegocio(
  workspaceId: string,
  rango: RangoDias,
  zonaHoraria: string,
): Promise<ImpactoNegocio> {
  const anterior = periodoAnterior(rango);

  return conEspacio(workspaceId, async (scope) => {
    const ajustesFila = await scope.query<{ settings: Record<string, unknown> | null; currency: string | null }>(
      `select w.settings, cp.currency
         from public.workspaces w
         left join public.company_profiles cp on cp.workspace_id = w.id
        where w.id = $1`,
      [scope.workspaceId],
    );
    const ajustes = leerAjustesImpacto(ajustesFila.rows[0]?.settings, ajustesFila.rows[0]?.currency);

    const agentesFila = await scope.query<{ id: string; name: string; catalog_slug: string; avatar_url: string | null }>(
      `select a.id, a.name, s.catalog_slug, a.avatar_url
         from public.agent_subscriptions s
         join public.agents a on a.workspace_id = s.workspace_id and a.id = s.agent_id
        where s.workspace_id = $1
          and s.status <> 'cancelled'
          and a.agent_type <> 'conversational'
          and a.status <> 'archived'
        order by s.started_at`,
      [scope.workspaceId],
    );
    const agentes: AgenteDelNegocio[] = agentesFila.rows.map((a) => ({
      id: a.id,
      nombre: a.name,
      slug: a.catalog_slug,
      avatar: a.avatar_url,
    }));

    const vacio = resumirImpacto({ encargos: [], rango, anterior, ajustes });
    if (agentes.length === 0) {
      return { ...vacio, rango, ajustes, agentes, enCurso: 0, fallidos: 0 };
    }

    const ids = agentes.map((a) => a.id);
    let tareas: FilaTarea[] = [];
    let enCurso = 0;
    let fallidos = 0;
    try {
      const filas = await scope.query<FilaTarea>(
        `select t.id, t.agent_id, t.titulo, t.creditos::text as creditos,
                to_char((coalesce(t.finished_at, t.updated_at) at time zone $3)::date, 'YYYY-MM-DD') as dia,
                coalesce(t.finished_at, t.updated_at) as terminado,
                (select coalesce(jsonb_agg(p->>'herramienta'), '[]'::jsonb)
                   from jsonb_array_elements(
                          case when jsonb_typeof(to_jsonb(t)->'pasos') = 'array'
                               then to_jsonb(t)->'pasos' else '[]'::jsonb end) p
                  where coalesce(p->>'estado', 'hecho') = 'hecho'
                    and p->>'herramienta' is not null) as herramientas_pasos,
                jsonb_path_query_array(
                  coalesce(t.mensajes, '[]'::jsonb),
                  'lax $[*].content[*] ? (@.type == "tool-call").toolName') as herramientas_mensajes
           from public.agent_tasks t
          where t.workspace_id = $1
            and t.agent_id = any($2::uuid[])
            and t.estado = 'done'
            and (coalesce(t.finished_at, t.updated_at) at time zone $3)::date between $4::date and $5::date
          order by terminado desc`,
        [scope.workspaceId, ids, zonaHoraria, anterior.desde, rango.hasta],
      );
      tareas = filas.rows;

      const estados = await scope.query<{ estado: string; n: string }>(
        `select estado, count(*)::text as n
           from public.agent_tasks
          where workspace_id = $1
            and agent_id = any($2::uuid[])
            and (estado in ('queued','running','esperando_aprobacion')
                 or (estado = 'failed'
                     and (updated_at at time zone $3)::date between $4::date and $5::date))
          group by estado`,
        [scope.workspaceId, ids, zonaHoraria, rango.desde, rango.hasta],
      );
      for (const fila of estados.rows) {
        if (fila.estado === "failed") fallidos += Number(fila.n);
        else enCurso += Number(fila.n);
      }
    } catch (error) {
      // Una instalación sin la tabla de encargos (migración 0015 sin aplicar)
      // enseña el impacto vacío en vez de tumbar la pantalla.
      if ((error as { code?: string }).code !== "42P01") throw error;
    }

    const encargos: EncargoParaImpacto[] = tareas.map((t) => {
      const pasos = (t.herramientas_pasos ?? []).filter((h): h is string => typeof h === "string");
      const mensajes = (t.herramientas_mensajes ?? []).filter((h): h is string => typeof h === "string");
      return {
        id: t.id,
        agenteId: t.agent_id,
        titulo: t.titulo,
        dia: t.dia,
        terminado: new Date(t.terminado).toISOString(),
        herramientas: pasos.length > 0 ? pasos : mensajes,
        creditos: Number(t.creditos) || 0,
      };
    });

    return {
      ...resumirImpacto({ encargos, rango, anterior, ajustes, recientes: 12 }),
      rango,
      ajustes,
      agentes,
      enCurso,
      fallidos,
    };
  });
}
