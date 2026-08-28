/**
 * `ConocimientoDbPort` de `@strappy/rag` contra el esquema real.
 *
 * El `KnowledgePort` que consumen el motor y la herramienta
 * `buscar_conocimiento` NO se implementa aquí: lo aporta la clase `Cerebro` de
 * `@strappy/rag`, que ya trae composición de dos turnos, presupuesto de tiempo
 * con degradación, umbrales y cita de la fuente. Lo que falta ahí y sobra aquí
 * son las tablas, y eso es exactamente lo que este archivo pone.
 *
 * Dos decisiones que no son cosméticas:
 *
 *  1. `aplicarPlan` respeta `conservar`: un trozo que solo se movió de sitio
 *     cambia de `position` y NADA MÁS —su embedding se queda como estaba—.
 *     Es lo que hace que revisar 400 URL que no cambiaron cueste cero llamadas
 *     al proveedor de embeddings.
 *
 *  2. `buscar` pasa `consulta` TAL CUAL al tercer argumento de
 *     `search_knowledge`. Quien llama ya la reescribió con `consultaLexica()`,
 *     porque `websearch_to_tsquery` une los términos con AND y una pregunta
 *     natural en español no casaría con nada.
 */
import type {
  ConocimientoDbPort,
  CerebroRef,
  FuenteRef,
  PlanEscritura,
} from '@strappy/rag';
import type { TenantScope } from '../client.js';
import { toVectorLiteral } from '../client.js';

export function crearConocimientoDb(scope: TenantScope): ConocimientoDbPort {
  const ws = scope.workspaceId;

  return {
    async cerebrosDeAgente({ workspaceId, agentId }) {
      scope.assertSameWorkspace(workspaceId);
      const { rows } = await scope.query<FilaCerebro>(
        `select b.id, b.workspace_id, b.name, b.language, b.embedding_model
           from public.agent_brains ab
           join public.brains b
             on b.workspace_id = ab.workspace_id and b.id = ab.brain_id
          where ab.workspace_id = $1 and ab.agent_id = $2 and ab.is_enabled
          order by b.created_at asc`,
        [ws, agentId],
      );
      return rows.map(aCerebroRef);
    },

    async cerebro({ workspaceId, cerebroId }) {
      scope.assertSameWorkspace(workspaceId);
      const { rows } = await scope.query<FilaCerebro>(
        `select id, workspace_id, name, language, embedding_model
           from public.brains where workspace_id = $1 and id = $2`,
        [ws, cerebroId],
      );
      const fila = rows[0];
      return fila ? aCerebroRef(fila) : null;
    },

    async registrarFuente({ workspaceId, cerebroId, tipo, titulo, uri, mimeType, metadata }) {
      scope.assertSameWorkspace(workspaceId);
      // La identidad de una fuente es su URI dentro del cerebro; si no tiene,
      // su titulo. Sin esto, reindexar una web crearia una fuente nueva cada vez.
      const { rows } = await scope.query<FilaFuente>(
        `with existente as (
           select id, brain_id, title, uri, content_hash, status
             from public.brain_sources
            where workspace_id = $1 and brain_id = $2
              and (($3::text is not null and uri = $3) or ($3::text is null and title = $4))
            limit 1
         ), creada as (
           insert into public.brain_sources
             (workspace_id, brain_id, kind, title, uri, mime_type, metadata, status)
           select $1, $2, $5, $4, $3, $6, coalesce($7::jsonb, '{}'::jsonb), 'pending'
            where not exists (select 1 from existente)
           returning id, brain_id, title, uri, content_hash, status
         )
         select * from existente union all select * from creada`,
        [
          ws,
          cerebroId,
          uri ?? null,
          titulo,
          tipo,
          mimeType ?? null,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
      const fila = rows[0];
      if (!fila) throw new Error('No se pudo registrar la fuente de conocimiento.');
      return aFuenteRef(fila);
    },

    async marcarEstadoFuente({ workspaceId, fuenteId, estado, hashContenido, detalle, metadata, indexadoEn }) {
      scope.assertSameWorkspace(workspaceId);
      await scope.query(
        `update public.brain_sources
            set status       = $3,
                content_hash = coalesce($4, content_hash),
                error_detail = $5,
                metadata     = metadata || coalesce($6::jsonb, '{}'::jsonb),
                indexed_at   = coalesce($7::timestamptz, indexed_at),
                updated_at   = now()
          where workspace_id = $1 and id = $2`,
        [
          ws,
          fuenteId,
          estado,
          hashContenido ?? null,
          detalle ?? null,
          metadata ? JSON.stringify(metadata) : null,
          indexadoEn ? indexadoEn.toISOString() : null,
        ],
      );
    },

    async trozosDeFuente({ workspaceId, fuenteId }) {
      scope.assertSameWorkspace(workspaceId);
      const { rows } = await scope.query<{ id: string; position: number; hash: string | null }>(
        `select id, position, metadata->>'hash' as hash
           from public.brain_chunks
          where workspace_id = $1 and source_id = $2
          order by position asc`,
        [ws, fuenteId],
      );
      return rows.map((r) => ({ id: r.id, posicion: r.position, hash: r.hash ?? '' }));
    },

    async aplicarPlan({ workspaceId, plan }) {
      scope.assertSameWorkspace(workspaceId);

      // 1 · Lo que solo cambió de sitio. Se mueve la posición y se deja el
      //     embedding intacto: reincrustarlo aquí seria pagar dos veces por el
      //     mismo texto, que es justo lo que el plan incremental evita.
      for (const trozo of plan.conservar) {
        await scope.query(
          `update public.brain_chunks
              set position = $3
            where workspace_id = $1 and id = $2 and position is distinct from $3`,
          [ws, trozo.id, trozo.posicion],
        );
      }

      // 2 · Lo que sobra.
      if (plan.eliminar.length > 0) {
        await scope.query(
          `delete from public.brain_chunks
            where workspace_id = $1 and id = any($2::uuid[])`,
          [ws, [...plan.eliminar]],
        );
      }

      // 3 · Lo nuevo o lo que cambió de contenido.
      if (plan.escribir.length > 0) {
        const { rows } = await scope.query<{ brain_id: string }>(
          `select brain_id from public.brain_sources where workspace_id = $1 and id = $2`,
          [ws, plan.fuenteId],
        );
        const brainId = rows[0]?.brain_id;
        if (!brainId) throw new Error(`La fuente ${plan.fuenteId} no existe en este espacio.`);

        for (const trozo of plan.escribir) {
          await scope.query(
            `insert into public.brain_chunks
               (workspace_id, brain_id, source_id, position, content, token_count, embedding, metadata)
             values ($1, $2, $3, $4, $5, $6, $7::vector, $8::jsonb)`,
            [
              ws,
              brainId,
              plan.fuenteId,
              trozo.posicion,
              trozo.contenido,
              trozo.tokens,
              trozo.embedding ? toVectorLiteral([...trozo.embedding]) : null,
              JSON.stringify({ ...trozo.metadata, hash: trozo.hash }),
            ],
          );
        }
      }

      await scope.query(
        `update public.brain_sources
            set chunk_count = (select count(*) from public.brain_chunks
                                where workspace_id = $1 and source_id = $2),
                updated_at = now()
          where workspace_id = $1 and id = $2`,
        [ws, plan.fuenteId],
      );
    },

    async buscar({ workspaceId, cerebroIds, consulta, embedding, k }) {
      scope.assertSameWorkspace(workspaceId);
      if (cerebroIds.length === 0) return [];
      const { rows } = await scope.query<{
        chunk_id: string;
        source_id: string;
        brain_id: string;
        content: string;
        score: number;
        vec_rank: number | null;
        lex_rank: number | null;
        distance: number | null;
        metadata: Record<string, unknown> | null;
      }>(
        `select * from public.search_knowledge($1::uuid[], $2, $3::vector, $4)`,
        [[...cerebroIds], consulta, toVectorLiteral([...embedding]), k],
      );
      return rows.map((r) => ({
        chunkId: r.chunk_id,
        sourceId: r.source_id,
        brainId: r.brain_id,
        contenido: r.content,
        puntuacion: Number(r.score),
        rangoVectorial: r.vec_rank,
        rangoLexico: r.lex_rank,
        distancia: r.distance,
        metadata: r.metadata ?? {},
      }));
    },

    async fuentesPorId({ workspaceId, ids }) {
      scope.assertSameWorkspace(workspaceId);
      const mapa = new Map<string, { titulo: string; uri: string | null }>();
      if (ids.length === 0) return mapa;
      const { rows } = await scope.query<{ id: string; title: string; uri: string | null }>(
        `select id, title, uri from public.brain_sources
          where workspace_id = $1 and id = any($2::uuid[])`,
        [ws, [...ids]],
      );
      for (const r of rows) mapa.set(r.id, { titulo: r.title, uri: r.uri });
      return mapa;
    },
  };
}

/** `ModelTiersPort` de `@strappy/rag`: el modelo de embeddings sale de la tabla. */
export function crearModelTiersPort(scope: TenantScope) {
  return {
    async resolver(input: { tarea: 'embed'; modo?: 'lite' | 'max' }) {
      const { rows } = await scope.query<{ primary_model: string; fallback_models: string[] | null }>(
        `select primary_model, fallback_models
           from public.model_tiers where mode = $1 and task = $2`,
        [input.modo ?? 'lite', input.tarea],
      );
      const fila = rows[0];
      if (!fila) throw new Error(`No hay modelo para la tarea "${input.tarea}".`);
      return { primary: fila.primary_model, fallbacks: fila.fallback_models ?? [] };
    },
  };
}

type FilaCerebro = {
  id: string;
  workspace_id: string;
  name: string;
  language: string;
  embedding_model: string;
};

function aCerebroRef(fila: FilaCerebro): CerebroRef {
  return {
    id: fila.id,
    workspaceId: fila.workspace_id,
    nombre: fila.name,
    idioma: fila.language,
    modeloEmbedding: fila.embedding_model,
  };
}

type FilaFuente = {
  id: string;
  brain_id: string;
  title: string;
  uri: string | null;
  content_hash: string | null;
  status: string;
};

function aFuenteRef(fila: FilaFuente): FuenteRef {
  return {
    id: fila.id,
    cerebroId: fila.brain_id,
    titulo: fila.title,
    uri: fila.uri,
    hashContenido: fila.content_hash,
    estado: fila.status as FuenteRef['estado'],
  };
}

export type { PlanEscritura };
