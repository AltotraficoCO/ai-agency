import "server-only";

/**
 * Lecturas de Conocimiento.
 *
 * Todo pasa por `conEspacio`: la RLS del rol worker solo deja ver el espacio
 * declarado. Las consultas van una detrás de otra —un scope es una sola
 * conexión— y los recuentos salen de las tablas, no de `brains.chunk_count`,
 * que durante un indexado todavía no refleja lo que se está escribiendo.
 */
import { conEspacio } from "../db/pool";
import { formatoLegible } from "./extractores";
import { traducirDetalle } from "./mensajes";
import type {
  AgenteConectable,
  AgenteVinculado,
  EstadoFuente,
  FichaCerebro,
  FuenteVista,
  ResumenCerebro,
  TipoFuenteVista,
} from "./tipos";

type FilaCerebro = {
  id: string;
  name: string;
  description: string | null;
  fuentes: string;
  fragmentos: string;
  aprendiendo: string;
  con_problemas: string;
  con_errores: string;
  por_revisar: string;
  actualizado: string;
};

const SQL_CEREBROS = `
  select b.id, b.name, b.description,
         (select count(*) from public.brain_sources s
           where s.workspace_id = b.workspace_id and s.brain_id = b.id) as fuentes,
         (select count(*) from public.brain_chunks c
           where c.workspace_id = b.workspace_id and c.brain_id = b.id) as fragmentos,
         (select count(*) from public.brain_sources s
           where s.workspace_id = b.workspace_id and s.brain_id = b.id
             and s.status in ('pending','indexing')) as aprendiendo,
         (select count(*) from public.brain_sources s
           where s.workspace_id = b.workspace_id and s.brain_id = b.id
             and s.status in ('error','stale')) as con_problemas,
         (select count(*) from public.brain_sources s
           where s.workspace_id = b.workspace_id and s.brain_id = b.id
             and s.status = 'error') as con_errores,
         (select count(*) from public.brain_sources s
           where s.workspace_id = b.workspace_id and s.brain_id = b.id
             and s.status = 'stale') as por_revisar,
         greatest(b.updated_at,
                  coalesce((select max(s.updated_at) from public.brain_sources s
                             where s.workspace_id = b.workspace_id and s.brain_id = b.id), b.updated_at)
         ) as actualizado
    from public.brains b
   where b.workspace_id = $1`;

function aResumen(fila: FilaCerebro, agentes: readonly AgenteVinculado[]): ResumenCerebro {
  return {
    id: fila.id,
    nombre: fila.name,
    descripcion: fila.description,
    fuentes: Number(fila.fuentes),
    fragmentos: Number(fila.fragmentos),
    aprendiendo: Number(fila.aprendiendo),
    conProblemas: Number(fila.con_problemas),
    conErrores: Number(fila.con_errores),
    porRevisar: Number(fila.por_revisar),
    agentes,
    actualizado: new Date(fila.actualizado).toISOString(),
  };
}

export async function listarCerebros(workspaceId: string): Promise<ResumenCerebro[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<FilaCerebro>(`${SQL_CEREBROS} order by actualizado desc`, [
      scope.workspaceId,
    ]);
    const vinculos = await scope.query<{ brain_id: string; id: string; name: string }>(
      `select ab.brain_id, a.id, a.name
         from public.agent_brains ab
         join public.agents a on a.workspace_id = ab.workspace_id and a.id = ab.agent_id
        where ab.workspace_id = $1 and ab.is_enabled and a.status <> 'archived'
        order by a.name`,
      [scope.workspaceId],
    );
    const porCerebro = new Map<string, AgenteVinculado[]>();
    for (const v of vinculos.rows) {
      const lista = porCerebro.get(v.brain_id) ?? [];
      lista.push({ id: v.id, nombre: v.name });
      porCerebro.set(v.brain_id, lista);
    }
    return rows.map((fila) => aResumen(fila, porCerebro.get(fila.id) ?? []));
  });
}

type FilaFuente = {
  id: string;
  kind: string;
  title: string;
  uri: string | null;
  mime_type: string | null;
  status: string;
  error_detail: string | null;
  chunk_count: number;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

function tipoDe(kind: string): TipoFuenteVista {
  if (kind === "url" || kind === "sitemap") return "web";
  if (kind === "file") return "archivo";
  return "texto";
}

function estadoDe(fila: FilaFuente): { estado: EstadoFuente; detalle: string | null } {
  switch (fila.status) {
    case "pending":
      return { estado: "pendiente", detalle: null };
    case "indexing":
      return {
        estado: "aprendiendo",
        detalle: fila.kind === "sitemap" ? "Leyendo las páginas de tu sitio…" : null,
      };
    case "indexed":
      return { estado: "lista", detalle: null };
    case "stale": {
      const motivo = fila.metadata?.["motivo"];
      return {
        estado: "revisar",
        detalle: fila.error_detail
          ? traducirDetalle(fila.error_detail)
          : motivo === "necesita_ocr"
            ? "No tiene texto que leer: probablemente sea un escaneo."
            : "No tenía contenido aprovechable. Conviene revisarla.",
      };
    }
    default:
      // Los detalles se traducen también al leer: hay errores viejos guardados
      // en crudo (en inglés, con instrucciones técnicas) que nadie debe ver así.
      return {
        estado: "error",
        detalle: traducirDetalle(fila.error_detail ?? ""),
      };
  }
}

function aFuenteVista(fila: FilaFuente): FuenteVista {
  const { estado, detalle } = estadoDe(fila);
  return {
    id: fila.id,
    tipo: tipoDe(fila.kind),
    titulo: fila.title,
    uri: fila.uri,
    formato: formatoLegible({ kind: fila.kind, mimeType: fila.mime_type, uri: fila.uri }),
    estado,
    detalle,
    fragmentos: Number(fila.chunk_count ?? 0),
    actualizado: new Date(fila.updated_at).toISOString(),
  };
}

export async function leerCerebro(workspaceId: string, cerebroId: string): Promise<FichaCerebro | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cerebroId)) return null;

  return conEspacio(workspaceId, async (scope) => {
    const cerebro = await scope.query<FilaCerebro>(`${SQL_CEREBROS} and b.id = $2`, [
      scope.workspaceId,
      cerebroId,
    ]);
    const fila = cerebro.rows[0];
    if (!fila) return null;

    const fuentes = await scope.query<FilaFuente>(
      `select id, kind, title, uri, mime_type, status, error_detail, chunk_count, metadata, updated_at
         from public.brain_sources
        where workspace_id = $1 and brain_id = $2
        order by created_at desc`,
      [scope.workspaceId, cerebroId],
    );

    // Solo los agentes que atienden por WhatsApp consultan conocimiento.
    const agentes = await scope.query<{
      id: string;
      name: string;
      publicado: boolean;
      conectado: boolean;
    }>(
      `select a.id, a.name,
              (a.active_version_id is not null and a.status = 'published') as publicado,
              exists (select 1 from public.agent_brains ab
                       where ab.workspace_id = a.workspace_id and ab.agent_id = a.id
                         and ab.brain_id = $2 and ab.is_enabled) as conectado
         from public.agents a
        where a.workspace_id = $1 and a.agent_type = 'conversational' and a.status <> 'archived'
        order by a.name`,
      [scope.workspaceId, cerebroId],
    );

    const disponibles: AgenteConectable[] = agentes.rows.map((a) => ({
      id: a.id,
      nombre: a.name,
      publicado: a.publicado,
      conectado: a.conectado,
    }));

    return {
      ...aResumen(
        fila,
        disponibles.filter((a) => a.conectado).map((a) => ({ id: a.id, nombre: a.nombre })),
      ),
      fuentesDetalle: fuentes.rows.map(aFuenteVista),
      agentesDisponibles: disponibles,
    };
  });
}
