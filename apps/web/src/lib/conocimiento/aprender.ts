import "server-only";

/**
 * El aprendizaje: de una fuente registrada a fragmentos buscables.
 *
 * Todo esto corre DESPUÉS de responder a la persona (`after()` de Next): la
 * fuente ya existe en «pendiente» y la pantalla la enseña al instante; aquí se
 * descarga, se extrae y se indexa, y la pantalla lo va viendo cambiar.
 *
 * Tres reglas:
 *  1. La red va FUERA de la transacción. Descargar un sitio puede tardar medio
 *     minuto y sostener una transacción abierta mientras tanto agota el pool.
 *  2. Cada documento se indexa en su propia transacción corta, y el «aprendiendo»
 *     se marca antes en otra: dentro de la transacción del indexado nadie más
 *     lo vería hasta el final.
 *  3. Nada se pierde en silencio. Si algo falla, la fuente queda en «error» con
 *     una frase en español que la persona entiende; si no había texto que leer,
 *     en «revisar» diciendo por qué.
 *
 * Embeddings: solo si hay proveedor (`crearEmbeddingsSiHayProveedor`); en
 * producción basta la clave de OpenRouter, la cartera del proyecto. Sin él se
 * indexa en modo solo texto —búsqueda por palabras— y funciona igual desde el
 * primer minuto. Al terminar de aprender, lo que la base tuviera sin vector de
 * antes se completa (`completarVectores`).
 */
import {
  crearEmbeddingsSiHayProveedor,
  crearFetch,
  htmlAMarkdown,
  indexarDocumento,
  ingerirTexto,
  type DocumentoCrudo,
  type ResultadoIngesta,
} from "@strappy/rag";
import { crearConocimientoDb, crearModelTiersPort } from "@strappy/db/adapters";
import { conEspacio } from "../db/pool";
import { analizarSitio } from "../meta/sitio";
import { completarVectores } from "./completar";
import { archivoADocumento, extensionDe, type ArchivoSubido } from "./extractores";
import { ErrorLegible, esFalloDeProveedor, mensajeLegible } from "./mensajes";

/** Tope de páginas al leer un sitio completo: lo bastante para una pyme, sin factura sorpresa. */
export const PAGINAS_POR_SITIO = 15;

// ---------------------------------------------------------------------------
// Estado de las fuentes (cada escritura en su propia transacción corta)
// ---------------------------------------------------------------------------

export type Fuente = { readonly workspaceId: string; readonly cerebroId: string; readonly fuenteId: string };

/**
 * Crea la fuente en «pendiente», o devuelve a «pendiente» la que ya existía con
 * la misma identidad (su dirección o nombre de archivo; si no tiene, su título).
 * Es la misma identidad que usa `@strappy/rag` al indexar, así que el indexado
 * reutiliza esta fila en vez de crear otra.
 */
export async function registrarPendiente(input: {
  workspaceId: string;
  cerebroId: string;
  usuarioId: string;
  kind: "text" | "file" | "url" | "sitemap";
  titulo: string;
  uri: string | null;
  mimeType?: string | null;
  contenido?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string }>(
      `with existente as (
         select id from public.brain_sources
          where workspace_id = $1 and brain_id = $2
            and (($3::text is not null and uri = $3) or ($3::text is null and uri is null and title = $4))
          limit 1
       ), actualizada as (
         update public.brain_sources s
            set status = 'pending', error_detail = null, kind = $5,
                mime_type = coalesce($6, s.mime_type),
                raw_content = coalesce($7, s.raw_content),
                metadata = s.metadata || coalesce($8::jsonb, '{}'::jsonb),
                updated_at = now()
           from existente e
          where s.id = e.id
         returning s.id
       ), creada as (
         insert into public.brain_sources
           (workspace_id, brain_id, kind, title, uri, mime_type, raw_content, metadata, status, created_by)
         select $1, $2, $5, $4, $3, $6, $7, coalesce($8::jsonb, '{}'::jsonb), 'pending', $9
          where not exists (select 1 from existente)
         returning id
       )
       select id from actualizada union all select id from creada`,
      [
        scope.workspaceId,
        input.cerebroId,
        input.uri,
        input.titulo,
        input.kind,
        input.mimeType ?? null,
        input.contenido ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.usuarioId,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("No se pudo registrar la fuente.");
    return id;
  });
}

async function marcar(
  fuente: Fuente,
  estado: "indexing" | "error" | "stale",
  detalle: string | null = null,
): Promise<void> {
  await conEspacio(fuente.workspaceId, (scope) =>
    scope.query(
      `update public.brain_sources set status = $3, error_detail = $4, updated_at = now()
        where workspace_id = $1 and id = $2`,
      [scope.workspaceId, fuente.fuenteId, estado, detalle],
    ),
  );
}

async function marcarError(fuente: Fuente, error: unknown): Promise<void> {
  try {
    await marcar(fuente, "error", mensajeLegible(error));
  } catch (fallo) {
    console.error("[conocimiento] no se pudo marcar el error de la fuente", fuente.fuenteId, fallo);
  }
}

/**
 * Un documento, una transacción.
 *
 * Si falla el proveedor de búsqueda por significado (clave caducada, cuota,
 * pasarela caída), la transacción se deshace y se repite en modo solo texto:
 * la fuente queda aprendida para buscar por palabras en vez de en error por
 * algo que no es culpa suya.
 */
async function indexar(
  fuente: Fuente,
  documento: DocumentoCrudo,
  opciones: { titulo?: string } = {},
): Promise<ResultadoIngesta> {
  try {
    const resultado = await indexarUnaVez(fuente, documento, opciones, false);
    // Lo nuevo ya se vectorizó; lo que la base tuviera en solo texto de antes
    // se completa ahora. Acotado y con pausa por base: no frena el aprendizaje.
    await completarVectores({ workspaceId: fuente.workspaceId, cerebroId: fuente.cerebroId });
    return resultado;
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error);
    // Cualquier fallo con la búsqueda por significado encendida se reintenta
    // solo por palabras, no solo los del proveedor: la escritura de vectores es
    // lo más nuevo del circuito y, si falla, la fuente tiene que quedar aprendida
    // igual. Si también falla sin vectores, el error es de verdad y se propaga.
    console.warn(
      esFalloDeProveedor(texto)
        ? "[conocimiento] proveedor de embeddings caído; se indexa solo por palabras"
        : "[conocimiento] falló el indexado con vectores; se reintenta solo por palabras",
      texto,
    );
    return indexarUnaVez(fuente, documento, opciones, true);
  }
}

async function indexarUnaVez(
  fuente: Fuente,
  documento: DocumentoCrudo,
  opciones: { titulo?: string },
  soloTexto: boolean,
): Promise<ResultadoIngesta> {
  return conEspacio(fuente.workspaceId, async (scope) => {
    const embeddings = soloTexto
      ? null
      : crearEmbeddingsSiHayProveedor({ modelTiers: crearModelTiersPort(scope) });
    const resultado = await indexarDocumento(
      { db: crearConocimientoDb(scope), ...(embeddings ? { embeddings } : { forzarSoloTexto: true }) },
      {
        workspaceId: scope.workspaceId,
        cerebroId: fuente.cerebroId,
        documento,
      },
    );
    // La fuente se registró con un título provisional (la dirección, el nombre
    // del archivo); el documento ya trae el de verdad.
    if (opciones.titulo) {
      await scope.query(
        `update public.brain_sources set title = $3 where workspace_id = $1 and id = $2`,
        [scope.workspaceId, resultado.fuenteId, opciones.titulo],
      );
    }
    return resultado;
  });
}

// ---------------------------------------------------------------------------
// Tareas de aprendizaje. Ninguna lanza: todo termina en un estado de la fuente.
// ---------------------------------------------------------------------------

export async function aprenderTexto(fuente: Fuente, entrada: { titulo: string; texto: string }): Promise<void> {
  try {
    await marcar(fuente, "indexing");
    await indexar(fuente, ingerirTexto({ titulo: entrada.titulo, texto: entrada.texto }));
  } catch (error) {
    await marcarError(fuente, error);
  }
}

/** Una sola página. */
export async function aprenderPagina(fuente: Fuente, url: string): Promise<void> {
  try {
    await marcar(fuente, "indexing");
    const respuesta = await crearFetch().obtener({ url });
    if (respuesta.status >= 400) {
      throw new ErrorLegible(`La página respondió con un error (${respuesta.status}). Revisa la dirección.`);
    }
    const tipo = respuesta.contentType.toLowerCase();
    if (tipo && !tipo.includes("html") && !tipo.startsWith("text/")) {
      throw new ErrorLegible(
        "Esa dirección no es una página con texto: parece un archivo. Si es un documento, súbelo en Archivos.",
      );
    }
    const convertido =
      !tipo || tipo.includes("html")
        ? htmlAMarkdown(respuesta.body, respuesta.finalUrl)
        : { titulo: url, markdown: respuesta.body };
    await indexar(
      fuente,
      {
        tipo: "url",
        titulo: convertido.titulo || url,
        uri: url,
        markdown: convertido.markdown,
        metadata: { urlFinal: respuesta.finalUrl },
      },
      { titulo: convertido.titulo || url },
    );
  } catch (error) {
    await marcarError(fuente, error);
  }
}

/**
 * El sitio completo: una fuente por página, para que la pantalla vea aparecer
 * cada una. La fila con la que se pidió (tipo `sitemap`) es solo el «estoy
 * leyendo tu sitio»: si al terminar alguna página se aprendió, sobra y se
 * quita; si no se aprendió ninguna, se queda con el error explicado.
 */
export async function aprenderSitio(fuente: Fuente, url: string): Promise<void> {
  try {
    await marcar(fuente, "indexing");
    const sitio = await analizarSitio(url, { maximoPaginas: PAGINAS_POR_SITIO });
    if (sitio.paginas.length === 0) {
      const motivo = sitio.descartadas[0]?.motivo;
      throw new ErrorLegible(
        `No encontré páginas con texto en ese sitio${motivo ? ` (${motivo})` : ""}. Prueba con la dirección de una página concreta.`,
      );
    }

    let aprendidas = 0;
    for (const pagina of sitio.paginas) {
      try {
        const resultado = await indexar(
          fuente,
          { ...pagina.documento, tipo: "url", uri: pagina.url },
          { titulo: pagina.documento.titulo || pagina.url },
        );
        if (resultado.estado === "indexed") aprendidas += 1;
      } catch (error) {
        // `indexarDocumento` ya dejó la página en error; se registra y se sigue
        // con las demás: una página rota no tumba el sitio entero.
        console.error("[conocimiento] página no indexada", pagina.url, error);
      }
    }

    if (aprendidas === 0) {
      throw new ErrorLegible("Leí el sitio pero no pude aprender de ninguna página. Vuelve a intentarlo.");
    }
    await conEspacio(fuente.workspaceId, (scope) =>
      scope.query(`delete from public.brain_sources where workspace_id = $1 and id = $2 and kind = 'sitemap'`, [
        scope.workspaceId,
        fuente.fuenteId,
      ]),
    );
  } catch (error) {
    await marcarError(fuente, error);
  }
}

export async function aprenderArchivo(fuente: Fuente, archivo: ArchivoSubido): Promise<void> {
  try {
    await marcar(fuente, "indexing");
    const documento = await archivoADocumento(archivo);
    // Se guarda lo extraído: permite volver a aprender sin pedir el archivo otra vez.
    await conEspacio(fuente.workspaceId, (scope) =>
      scope.query(`update public.brain_sources set raw_content = $3 where workspace_id = $1 and id = $2`, [
        scope.workspaceId,
        fuente.fuenteId,
        documento.markdown,
      ]),
    );
    const resultado = await indexar(fuente, documento);
    if (resultado.estado === "stale" && resultado.necesitaOcr && extensionDe(archivo.nombre) === "pdf") {
      await marcar(fuente, "stale", "Este PDF parece escaneado: no tiene texto que leer.");
    }
  } catch (error) {
    await marcarError(fuente, error);
  }
}

/**
 * «Volver a leer». Devuelve la tarea para correr en segundo plano, o un mensaje
 * si esa fuente no se puede releer.
 */
export async function prepararRelectura(
  fuente: Fuente,
): Promise<{ tarea: () => Promise<void> } | { error: string }> {
  const fila = await conEspacio(fuente.workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      kind: string;
      title: string;
      uri: string | null;
      mime_type: string | null;
      raw_content: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `select kind, title, uri, mime_type, raw_content, metadata from public.brain_sources
        where workspace_id = $1 and brain_id = $2 and id = $3`,
      [scope.workspaceId, fuente.cerebroId, fuente.fuenteId],
    );
    return rows[0] ?? null;
  });
  if (!fila) return { error: "Esa fuente ya no existe." };

  if (fila.kind === "url" && fila.uri) {
    const url = fila.uri;
    return { tarea: () => aprenderPagina(fuente, url) };
  }
  if (fila.kind === "sitemap") {
    const sitio = fila.metadata?.["sitio"];
    const url = fila.uri ?? (typeof sitio === "string" ? sitio : null);
    if (!url) return { error: "No guardé la dirección de este sitio: vuelve a añadirla." };
    return { tarea: () => aprenderSitio(fuente, url) };
  }
  if (fila.kind === "file") {
    if (!fila.raw_content) return { error: "Para volver a leer este archivo, súbelo de nuevo." };
    const markdown = fila.raw_content;
    return {
      tarea: async () => {
        try {
          await marcar(fuente, "indexing");
          await indexar(
            fuente,
            {
              tipo: "file",
              titulo: fila.title,
              ...(fila.uri ? { uri: fila.uri } : {}),
              ...(fila.mime_type ? { mimeType: fila.mime_type } : {}),
              markdown,
            },
          );
        } catch (error) {
          await marcarError(fuente, error);
        }
      },
    };
  }
  if (!fila.raw_content) return { error: "No guardé el texto de esta fuente: vuelve a pegarlo." };
  const texto = fila.raw_content;
  return { tarea: () => aprenderTexto(fuente, { titulo: fila.title, texto }) };
}

/** Deja una fuente en «pendiente» antes de releerla, para que la pantalla lo vea al instante. */
export async function devolverAPendiente(fuente: Fuente): Promise<void> {
  await conEspacio(fuente.workspaceId, (scope) =>
    scope.query(
      `update public.brain_sources set status = 'pending', error_detail = null, updated_at = now()
        where workspace_id = $1 and id = $2`,
      [scope.workspaceId, fuente.fuenteId],
    ),
  );
}
