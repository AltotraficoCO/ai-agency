import "server-only";

/**
 * El borrador persistente de Strap.
 *
 * Aquí está la promesa que separa a Strap de un chat: cierras el navegador,
 * vuelves mañana y la conversación retoma en el punto exacto. Lo que lo hace
 * posible es que el ESTADO no está en el historial —está en `agent_drafts`:
 * `spec` guarda lo que se sabe y `progress.fase` en qué punto del guion va.
 * El historial es solo la ventana por la que se ve; se guarda para que la
 * pantalla no aparezca en blanco, no porque nada dependa de él.
 *
 * Un hilo es una fila de `agent_drafts`. `thread_id` apunta a sí misma para
 * que la ruta `/c/{id}` sea consultable desde SQL sin conocer esta convención.
 */
import {
  ETIQUETA_FASE,
  capacidadDelBorrador,
  esFaseMeta,
  faseParaColumna,
  fusionarBorrador,
  type FaseMeta,
} from "@strappy/core";
import { conEspacio } from "../db/pool";
import type { ResumenHilo } from "./tipos";

/** Historial visible. Se recorta porque una fila de jsonb no es un almacén de mensajes. */
export const MAXIMO_MENSAJES_GUARDADOS = 80;

export type Hilo = {
  readonly id: string;
  readonly capacidad: string;
  readonly fase: FaseMeta;
  readonly titulo: string;
  readonly borrador: Record<string, unknown>;
  /** `UIMessage[]` del AI SDK, tal cual. Se guarda opaco a propósito. */
  readonly mensajes: readonly unknown[];
  readonly agenteId: string | null;
  readonly actualizado: string;
};

type FilaHilo = {
  id: string;
  agent_id: string | null;
  spec: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  updated_at: string;
};

export async function crearHilo(input: {
  workspaceId: string;
  usuarioId: string;
  capacidad?: string;
  titulo?: string;
}): Promise<string> {
  const capacidad = capacidadDelBorrador(input.capacidad);
  const borrador = capacidad.draftSchema.parse({});

  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string }>(
      `insert into public.agent_drafts (workspace_id, spec, phase, progress, created_by)
       values ($1, $2::jsonb, $3, $4::jsonb, $5)
       returning id`,
      [
        scope.workspaceId,
        JSON.stringify(borrador),
        faseParaColumna("intencion"),
        JSON.stringify({
          capacidad: capacidad.slug,
          fase: "intencion",
          titulo: input.titulo ?? "Conversación nueva",
          mensajes: [],
        }),
        input.usuarioId,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("No se pudo abrir el hilo con Strap.");
    // El hilo se apunta a sí mismo: la ruta /c/{id} es el thread_id.
    await scope.query(
      `update public.agent_drafts set thread_id = id where workspace_id = $1 and id = $2`,
      [scope.workspaceId, id],
    );
    return id;
  });
}

export async function leerHilo(workspaceId: string, id: string): Promise<Hilo | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<FilaHilo>(
      `select id, agent_id, spec, progress, updated_at
         from public.agent_drafts
        where workspace_id = $1 and id = $2`,
      [scope.workspaceId, id],
    );
    const fila = rows[0];
    return fila ? aHilo(fila) : null;
  });
}

export async function listarHilos(workspaceId: string, limite = 8): Promise<ResumenHilo[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<FilaHilo>(
      `select id, agent_id, spec, progress, updated_at
         from public.agent_drafts
        where workspace_id = $1 and thread_id is not null
        order by updated_at desc
        limit $2`,
      [scope.workspaceId, limite],
    );
    return rows.map((fila) => {
      const hilo = aHilo(fila);
      return {
        id: hilo.id,
        titulo: hilo.titulo,
        fase: hilo.fase,
        etiquetaFase: ETIQUETA_FASE[hilo.fase],
        actualizado: hilo.actualizado,
        publicado: hilo.agenteId !== null,
      };
    });
  });
}

export type CambioHilo = {
  /** Parcial: se funde sobre lo que ya hay y se valida contra el esquema. */
  borrador?: Record<string, unknown>;
  fase?: FaseMeta;
  titulo?: string;
  mensajes?: readonly unknown[];
  agenteId?: string;
};

/**
 * Guarda un cambio parcial del hilo.
 *
 * Lee, funde, valida y escribe dentro de la misma transacción. No es
 * pedantería: dos herramientas del mismo turno escriben el borrador una detrás
 * de otra, y con un lee-fuera/escribe-dentro la segunda pisaría a la primera.
 */
export async function actualizarHilo(
  workspaceId: string,
  id: string,
  cambio: CambioHilo,
): Promise<Hilo> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<FilaHilo>(
      `select id, agent_id, spec, progress, updated_at
         from public.agent_drafts
        where workspace_id = $1 and id = $2
        for update`,
      [scope.workspaceId, id],
    );
    const fila = rows[0];
    if (!fila) throw new Error("Ese hilo no existe en este espacio de trabajo.");

    const actual = aHilo(fila);
    const capacidad = capacidadDelBorrador(actual.capacidad);
    const borrador = cambio.borrador
      ? (fusionarBorrador(capacidad.draftSchema, actual.borrador, cambio.borrador) as Record<
          string,
          unknown
        >)
      : actual.borrador;

    const fase = cambio.fase ?? actual.fase;
    const mensajes = (cambio.mensajes ?? actual.mensajes).slice(-MAXIMO_MENSAJES_GUARDADOS);
    const progreso = {
      capacidad: actual.capacidad,
      fase,
      titulo: cambio.titulo?.trim() || actual.titulo,
      mensajes,
    };

    await scope.query(
      `update public.agent_drafts
          set spec = $3::jsonb, phase = $4, progress = $5::jsonb,
              agent_id = coalesce($6, agent_id), updated_at = now()
        where workspace_id = $1 and id = $2`,
      [
        scope.workspaceId,
        id,
        JSON.stringify(borrador),
        faseParaColumna(fase),
        JSON.stringify(progreso),
        cambio.agenteId ?? null,
      ],
    );

    return {
      id,
      capacidad: actual.capacidad,
      fase,
      titulo: progreso.titulo,
      borrador,
      mensajes,
      agenteId: cambio.agenteId ?? actual.agenteId,
      actualizado: new Date().toISOString(),
    };
  });
}

/**
 * La ficha de la empresa y qué rutas del borrador quedan ya contestadas por
 * ella. Es la mitad de la sensación de «ya me conoce»: lo que la empresa
 * contestó una vez no se vuelve a preguntar en ningún agente.
 */
export type ContextoEmpresa = {
  readonly datos: Readonly<Record<string, string>>;
  readonly rutasConocidas: readonly string[];
};

export async function leerContextoEmpresa(workspaceId: string): Promise<ContextoEmpresa> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      brand_name: string | null;
      legal_name: string | null;
      description: string | null;
      industry: string | null;
      website: string | null;
      city: string | null;
      timezone: string | null;
      business_hours: Record<string, unknown> | null;
    }>(
      `select brand_name, legal_name, description, industry, website, city, timezone, business_hours
         from public.company_profiles where workspace_id = $1`,
      [scope.workspaceId],
    );
    const fila = rows[0];
    if (!fila) return { datos: {}, rutasConocidas: [] };

    const datos: Record<string, string> = {};
    const rutas: string[] = [];
    const poner = (clave: string, ruta: string, valor: string | null | undefined): void => {
      const limpio = (valor ?? "").trim();
      if (limpio.length === 0) return;
      datos[clave] = limpio;
      rutas.push(ruta);
    };

    poner("nombre", "empresa.nombre", fila.brand_name ?? fila.legal_name);
    poner("descripcion", "empresa.descripcion", fila.description);
    poner("sector", "empresa.sector", fila.industry);
    poner("sitioWeb", "empresa.sitioWeb", fila.website);
    poner("horario", "empresa.horario", textoHorario(fila.business_hours));
    if (fila.city) datos["ciudad"] = fila.city;
    if (fila.timezone) datos["zonaHoraria"] = fila.timezone;

    return { datos, rutasConocidas: rutas };
  });
}

function textoHorario(valor: Record<string, unknown> | null): string {
  if (!valor || Object.keys(valor).length === 0) return "";
  const texto = valor["texto"] ?? valor["descripcion"];
  return typeof texto === "string" ? texto : "";
}

function aHilo(fila: FilaHilo): Hilo {
  const progreso = fila.progress ?? {};
  const faseGuardada = progreso["fase"];
  const mensajes = progreso["mensajes"];
  return {
    id: fila.id,
    capacidad: texto(progreso["capacidad"]),
    fase: esFaseMeta(faseGuardada) ? faseGuardada : "intencion",
    titulo: texto(progreso["titulo"]) || "Conversación nueva",
    borrador: (fila.spec ?? {}) as Record<string, unknown>,
    mensajes: Array.isArray(mensajes) ? mensajes : [],
    agenteId: fila.agent_id,
    actualizado: new Date(fila.updated_at).toISOString(),
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}
