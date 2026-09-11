"use server";

/**
 * Acciones de Conocimiento.
 *
 * Todas devuelven `ResultadoAccion` y nunca lanzan hacia la interfaz: un error
 * vuelve como `{ ok: false, error }` con un mensaje en español para la persona.
 * Las que añaden fuentes responden al instante con la fuente en «pendiente» y
 * el aprendizaje sigue en segundo plano (`after`); la interfaz refresca hasta
 * que termina.
 *
 * Pueden cambiar el conocimiento los papeles con `knowledge.write`: propietario,
 * administrador y constructor. Leerlo lo puede cualquier miembro (RLS).
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { Cerebro, crearEmbeddingsSiHayProveedor } from "@strappy/rag";
import { crearConocimientoDb, crearModelTiersPort } from "@strappy/db/adapters";
import { conEspacio } from "../db/pool";
import { obtenerUsuarioActual, type UsuarioActual } from "../identidad";
import { normalizarUrl } from "../meta/sitio";
import {
  aprenderPagina,
  aprenderSitio,
  aprenderTexto,
  devolverAPendiente,
  prepararRelectura,
  registrarPendiente,
} from "./aprender";
import type { FragmentoEncontrado, ResultadoAccion } from "./tipos";

const PAPELES_QUE_EDITAN = new Set(["owner", "admin", "builder"]);

const id = z.string().uuid();

async function quienEdita(): Promise<UsuarioActual | { error: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: "Tu sesión terminó. Vuelve a entrar." };
  if (!PAPELES_QUE_EDITAN.has(usuario.rol)) {
    return { error: "Tu papel en este espacio no permite cambiar el conocimiento." };
  }
  return usuario;
}

async function existeCerebro(workspaceId: string, cerebroId: string): Promise<boolean> {
  if (!id.safeParse(cerebroId).success) return false;
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query(`select 1 from public.brains where workspace_id = $1 and id = $2`, [
      scope.workspaceId,
      cerebroId,
    ]);
    return rows.length > 0;
  });
}

function esNombreRepetido(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

function refrescar(cerebroId?: string): void {
  revalidatePath("/conocimiento");
  if (cerebroId) revalidatePath(`/conocimiento/${cerebroId}`);
}

/** La tarea de fondo nunca debe romper la respuesta: sus fallos ya quedan en la fuente. */
function enSegundoPlano(tarea: () => Promise<void>): void {
  after(async () => {
    try {
      await tarea();
    } catch (error) {
      console.error("[conocimiento] tarea de fondo", error);
    }
  });
}

const datosCerebro = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, "Ponle un nombre de al menos 2 letras.")
    .max(60, "El nombre puede tener como mucho 60 caracteres."),
  descripcion: z.string().trim().max(240, "La descripción puede tener como mucho 240 caracteres.").optional(),
});

function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Revisa los datos.";
}

export async function accionCrearCerebro(entrada: {
  nombre: string;
  descripcion?: string;
}): Promise<ResultadoAccion<{ id: string }>> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  const datos = datosCerebro.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };

  try {
    const nuevo = await conEspacio(usuario.workspaceId, async (scope) => {
      const { rows } = await scope.query<{ id: string }>(
        `insert into public.brains (workspace_id, name, description, created_by)
         values ($1, $2, $3, $4) returning id`,
        [scope.workspaceId, datos.data.nombre, datos.data.descripcion || null, usuario.id],
      );
      return rows[0]?.id;
    });
    if (!nuevo) return { ok: false, error: "No se pudo crear la base de conocimiento." };
    refrescar();
    return { ok: true, datos: { id: nuevo } };
  } catch (error) {
    if (esNombreRepetido(error)) return { ok: false, error: "Ya tienes una base con ese nombre." };
    console.error("[conocimiento] crear", error);
    return { ok: false, error: "No se pudo crear la base de conocimiento." };
  }
}

export async function accionEditarCerebro(
  cerebroId: string,
  entrada: { nombre: string; descripcion?: string },
): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  const datos = datosCerebro.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  if (!(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa base de conocimiento no existe." };
  }

  try {
    await conEspacio(usuario.workspaceId, (scope) =>
      scope.query(
        `update public.brains set name = $3, description = $4, updated_at = now()
          where workspace_id = $1 and id = $2`,
        [scope.workspaceId, cerebroId, datos.data.nombre, datos.data.descripcion || null],
      ),
    );
    refrescar(cerebroId);
    return { ok: true };
  } catch (error) {
    if (esNombreRepetido(error)) return { ok: false, error: "Ya tienes una base con ese nombre." };
    console.error("[conocimiento] editar", error);
    return { ok: false, error: "No se pudieron guardar los cambios." };
  }
}

export async function accionEliminarCerebro(cerebroId: string): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  if (!(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa base de conocimiento no existe." };
  }
  // Fuentes, fragmentos y vínculos con agentes caen en cascada.
  await conEspacio(usuario.workspaceId, (scope) =>
    scope.query(`delete from public.brains where workspace_id = $1 and id = $2`, [scope.workspaceId, cerebroId]),
  );
  refrescar();
  revalidatePath("/whatsapp/agentes");
  return { ok: true };
}

const datosTexto = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, "Ponle un título, por ejemplo «Precios» o «Preguntas frecuentes».")
    .max(120, "El título puede tener como mucho 120 caracteres."),
  texto: z
    .string()
    .trim()
    .min(20, "Escribe un poco más: con menos de 20 caracteres no hay nada que aprender.")
    .max(200_000, "Ese texto es demasiado largo: súbelo como archivo."),
});

export async function accionAgregarTexto(
  cerebroId: string,
  entrada: { titulo: string; texto: string },
): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  const datos = datosTexto.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  if (!(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa base de conocimiento no existe." };
  }

  // Los textos se identifican por su título: dos «Precios» se pisarían. El
  // segundo pasa a «Precios (2)».
  const titulo = await conEspacio(usuario.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ title: string }>(
      `select title from public.brain_sources
        where workspace_id = $1 and brain_id = $2 and uri is null and (title = $3 or title like $4)`,
      [scope.workspaceId, cerebroId, datos.data.titulo, `${datos.data.titulo} (%)`],
    );
    const usados = new Set(rows.map((r) => r.title));
    if (!usados.has(datos.data.titulo)) return datos.data.titulo;
    let n = 2;
    while (usados.has(`${datos.data.titulo} (${n})`)) n += 1;
    return `${datos.data.titulo} (${n})`;
  });

  const fuenteId = await registrarPendiente({
    workspaceId: usuario.workspaceId,
    cerebroId,
    usuarioId: usuario.id,
    kind: "text",
    titulo,
    uri: null,
    contenido: datos.data.texto,
  });
  enSegundoPlano(() =>
    aprenderTexto({ workspaceId: usuario.workspaceId, cerebroId, fuenteId }, { titulo, texto: datos.data.texto }),
  );
  refrescar(cerebroId);
  return { ok: true };
}

export async function accionAgregarUrl(
  cerebroId: string,
  entrada: { url: string; todoElSitio: boolean },
): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  if (!(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa base de conocimiento no existe." };
  }

  let url: string;
  try {
    url = normalizarUrl(String(entrada.url ?? ""));
    const { protocol, hostname } = new URL(url);
    if ((protocol !== "http:" && protocol !== "https:") || !hostname.includes(".")) throw new Error();
  } catch {
    return { ok: false, error: "Esa dirección no parece válida. Escríbela como tunegocio.com o https://tunegocio.com/precios." };
  }

  const host = new URL(url).hostname.replace(/^www\./, "");
  const fuenteId = await registrarPendiente({
    workspaceId: usuario.workspaceId,
    cerebroId,
    usuarioId: usuario.id,
    kind: entrada.todoElSitio ? "sitemap" : "url",
    titulo: entrada.todoElSitio ? `Sitio web · ${host}` : url,
    // La fila provisional del sitio NO lleva la dirección como `uri`: la
    // página principal tiene esa misma dirección, el indexado la reutilizaba
    // y al borrar la provisional se llevaba la página aprendida. La dirección
    // queda en metadata para poder volver a leer el sitio.
    uri: entrada.todoElSitio ? null : url,
    ...(entrada.todoElSitio ? { metadata: { sitio: url } } : {}),
  });
  const fuente = { workspaceId: usuario.workspaceId, cerebroId, fuenteId };
  enSegundoPlano(() => (entrada.todoElSitio ? aprenderSitio(fuente, url) : aprenderPagina(fuente, url)));
  refrescar(cerebroId);
  return { ok: true };
}

export async function accionEliminarFuente(cerebroId: string, fuenteId: string): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  if (!id.safeParse(fuenteId).success || !(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa fuente ya no existe." };
  }
  // Los fragmentos se van con la fuente (on delete cascade).
  await conEspacio(usuario.workspaceId, (scope) =>
    scope.query(`delete from public.brain_sources where workspace_id = $1 and brain_id = $2 and id = $3`, [
      scope.workspaceId,
      cerebroId,
      fuenteId,
    ]),
  );
  refrescar(cerebroId);
  return { ok: true };
}

export async function accionReleerFuente(cerebroId: string, fuenteId: string): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  if (!id.safeParse(fuenteId).success || !(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa fuente ya no existe." };
  }

  const fuente = { workspaceId: usuario.workspaceId, cerebroId, fuenteId };
  const preparada = await prepararRelectura(fuente);
  if ("error" in preparada) return { ok: false, error: preparada.error };

  await devolverAPendiente(fuente);
  enSegundoPlano(preparada.tarea);
  refrescar(cerebroId);
  return { ok: true };
}

export async function accionConectarAgente(
  cerebroId: string,
  agenteId: string,
  conectado: boolean,
): Promise<ResultadoAccion> {
  const usuario = await quienEdita();
  if ("error" in usuario) return { ok: false, error: usuario.error };
  if (!id.safeParse(agenteId).success || !(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "No encontré esa base o ese agente." };
  }

  const resultado = await conEspacio(usuario.workspaceId, async (scope) => {
    const agente = await scope.query(
      `select 1 from public.agents
        where workspace_id = $1 and id = $2 and agent_type = 'conversational' and status <> 'archived'`,
      [scope.workspaceId, agenteId],
    );
    if (agente.rows.length === 0) return false;
    if (conectado) {
      await scope.query(
        `insert into public.agent_brains (workspace_id, agent_id, brain_id)
         values ($1, $2, $3)
         on conflict (agent_id, brain_id) do update set is_enabled = true`,
        [scope.workspaceId, agenteId, cerebroId],
      );
    } else {
      await scope.query(
        `delete from public.agent_brains where workspace_id = $1 and agent_id = $2 and brain_id = $3`,
        [scope.workspaceId, agenteId, cerebroId],
      );
    }
    return true;
  });
  if (!resultado) return { ok: false, error: "Solo los agentes de WhatsApp pueden usar conocimiento." };

  refrescar(cerebroId);
  revalidatePath("/whatsapp/agentes");
  return { ok: true };
}

export async function accionProbarBusqueda(
  cerebroId: string,
  consulta: string,
): Promise<ResultadoAccion<{ fragmentos: FragmentoEncontrado[] }>> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, error: "Tu sesión terminó. Vuelve a entrar." };
  const pregunta = String(consulta ?? "").trim();
  if (pregunta.length < 2) return { ok: false, error: "Escribe una pregunta, por ejemplo «¿cuánto cuesta el envío?»." };
  if (pregunta.length > 300) return { ok: false, error: "La pregunta es demasiado larga." };
  if (!(await existeCerebro(usuario.workspaceId, cerebroId))) {
    return { ok: false, error: "Esa base de conocimiento no existe." };
  }

  try {
    const explicacion = await conEspacio(usuario.workspaceId, async (scope) => {
      const embeddings = crearEmbeddingsSiHayProveedor({ modelTiers: crearModelTiersPort(scope) });
      const cerebro = new Cerebro({ db: crearConocimientoDb(scope), ...(embeddings ? { embeddings } : {}) });
      return cerebro.explicarBusqueda(pregunta, { workspaceId: scope.workspaceId, cerebroIds: [cerebroId] });
    });

    const usados = explicacion.candidatos.filter((c) => c.usado);
    // Si nada pasa el umbral pero hubo algo parecido, se enseña lo más cercano:
    // «no encontré nada» sin pistas no ayuda a entender qué le falta a la base.
    const elegidos = usados.length > 0 ? usados : explicacion.candidatos.slice(0, 3);
    const maxima = Math.max(0, ...elegidos.map((c) => c.puntuacion));
    return {
      ok: true,
      datos: {
        fragmentos: elegidos.map((c) => ({
          texto: c.extracto,
          titulo: c.documento || null,
          fuente: c.fuente ?? null,
          puntuacion: maxima > 0 ? Math.round((c.puntuacion / maxima) * 100) / 100 : 0,
        })),
      },
    };
  } catch (error) {
    console.error("[conocimiento] probar búsqueda", error);
    return { ok: false, error: "No se pudo buscar ahora mismo. Vuelve a intentarlo." };
  }
}
