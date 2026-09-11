import "server-only";

/**
 * Volver a aprender lo que falló.
 *
 * Dos caminos que comparten la misma lectura y las mismas reglas
 * (`recuperar-reglas.ts`):
 *  · Automático, al abrir Conocimiento o una base: solo los fallos del
 *    proveedor de búsqueda por significado, acotado y como mucho una vez al día
 *    por fuente. Las fuentes se ponen «en cola» ANTES de pintar la página —así
 *    la pantalla ya enseña que está aprendiendo y se refresca sola— y el
 *    aprendizaje corre después de responder.
 *  · Manual, con «Reintentar lo que falló»: todo lo que esté en error o por
 *    revisar y se pueda releer.
 *
 * Nada de esto lanza hacia la página: si falla, la base se enseña como estaba.
 */
import { conEspacio } from "../db/pool";
import { devolverAPendiente, prepararRelectura, type Fuente } from "./aprender";
import { sePuedeReleer, tocaReintentoAutomatico, type FuenteFallida } from "./recuperar-reglas";

const PAUSA_MS = 60_000;
const MAXIMO_AUTOMATICO_POR_PASADA = 10;

declare global {
  // Sobrevive a las recargas de módulos en desarrollo, igual que el pool.
  var __strappyUltimaRecuperacion: Map<string, number> | undefined;
}

function ultimaRecuperacion(): Map<string, number> {
  globalThis.__strappyUltimaRecuperacion ??= new Map();
  return globalThis.__strappyUltimaRecuperacion;
}

type Tarea = () => Promise<void>;

async function leerFallidas(
  workspaceId: string,
  estados: readonly string[],
  cerebroId?: string,
): Promise<FuenteFallida[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      brain_id: string;
      kind: string;
      status: string;
      title: string;
      uri: string | null;
      tiene_contenido: boolean;
      error_detail: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `select id, brain_id, kind, status, title, uri, error_detail, metadata,
              (raw_content is not null and length(raw_content) > 0) as tiene_contenido
         from public.brain_sources
        where workspace_id = $1 and status = any($2::text[])
          and ($3::uuid is null or brain_id = $3::uuid)
        order by updated_at asc
        limit 200`,
      [scope.workspaceId, [...estados], cerebroId ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      cerebroId: r.brain_id,
      kind: r.kind,
      status: r.status,
      titulo: r.title,
      uri: r.uri,
      tieneContenido: r.tiene_contenido,
      errorDetail: r.error_detail,
      metadata: r.metadata,
    }));
  });
}

async function anotar(
  workspaceId: string,
  fuenteId: string,
  cambios: { reintentoAutomatico?: string; detalle?: string },
): Promise<void> {
  await conEspacio(workspaceId, (scope) =>
    scope.query(
      `update public.brain_sources
          set metadata = case when $3::text is null then metadata
                              else coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reintentoAutomatico', $3::text) end,
              error_detail = coalesce($4::text, error_detail)
        where workspace_id = $1 and id = $2`,
      [scope.workspaceId, fuenteId, cambios.reintentoAutomatico ?? null, cambios.detalle ?? null],
    ),
  );
}

/** Deja la fuente en cola y devuelve su aprendizaje; o el motivo si no se puede releer. */
async function encolar(workspaceId: string, fallida: FuenteFallida): Promise<{ tarea: Tarea } | { motivo: string }> {
  const regla = sePuedeReleer(fallida);
  if (!regla.releible) return { motivo: regla.motivo };
  const fuente: Fuente = { workspaceId, cerebroId: fallida.cerebroId, fuenteId: fallida.id };
  const preparada = await prepararRelectura(fuente);
  if ("error" in preparada) return { motivo: preparada.error };
  await devolverAPendiente(fuente);
  return { tarea: preparada.tarea };
}

function enCadena(tareas: readonly Tarea[]): Tarea {
  return async () => {
    // Una detrás de otra: cada una abre sus transacciones y sus llamadas de red,
    // y en paralelo agotarían el pool con una base grande.
    for (const tarea of tareas) {
      try {
        await tarea();
      } catch (error) {
        console.error("[conocimiento] reintento de fuente", error);
      }
    }
  };
}

/**
 * Recuperación automática. Pone en cola lo recuperable y devuelve el
 * aprendizaje para correrlo después de responder, o `null` si no hay nada.
 * Nunca lanza.
 */
export async function prepararRecuperacionAutomatica(input: {
  workspaceId: string;
  cerebroId?: string;
}): Promise<Tarea | null> {
  const clave = `${input.workspaceId}:${input.cerebroId ?? "*"}`;
  const ahora = Date.now();
  const antes = ultimaRecuperacion().get(clave);
  if (antes !== undefined && ahora - antes < PAUSA_MS) return null;
  ultimaRecuperacion().set(clave, ahora);

  try {
    const fallidas = await leerFallidas(input.workspaceId, ["error"], input.cerebroId);
    const candidatas = fallidas.filter((f) => tocaReintentoAutomatico(f, ahora)).slice(0, MAXIMO_AUTOMATICO_POR_PASADA);
    const tareas: Tarea[] = [];
    const sello = new Date(ahora).toISOString();

    for (const fallida of candidatas) {
      // El sello va primero: si esto vuelve a fallar, mañana se reintenta, no en bucle.
      await anotar(input.workspaceId, fallida.id, { reintentoAutomatico: sello });
      const resultado = await encolar(input.workspaceId, fallida);
      if ("tarea" in resultado) {
        tareas.push(resultado.tarea);
      } else {
        // No se puede releer sola (un texto de Strap que no se guardó): en vez del
        // error técnico, se dice qué hacer.
        await anotar(input.workspaceId, fallida.id, { detalle: resultado.motivo });
      }
    }
    return tareas.length > 0 ? enCadena(tareas) : null;
  } catch (error) {
    console.warn("[conocimiento] recuperación automática", {
      workspaceId: input.workspaceId,
      cerebroId: input.cerebroId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** «Reintentar lo que falló»: todo lo releíble en error o por revisar de una base. */
export async function reintentarFallidas(input: { workspaceId: string; cerebroId: string }): Promise<{
  tarea: Tarea | null;
  reintentadas: number;
  noSePueden: { titulo: string; motivo: string }[];
}> {
  const fallidas = await leerFallidas(input.workspaceId, ["error", "stale"], input.cerebroId);
  const tareas: Tarea[] = [];
  const noSePueden: { titulo: string; motivo: string }[] = [];
  for (const fallida of fallidas) {
    const resultado = await encolar(input.workspaceId, fallida);
    if ("tarea" in resultado) tareas.push(resultado.tarea);
    else noSePueden.push({ titulo: fallida.titulo, motivo: resultado.motivo });
  }
  return { tarea: tareas.length > 0 ? enCadena(tareas) : null, reintentadas: tareas.length, noSePueden };
}
