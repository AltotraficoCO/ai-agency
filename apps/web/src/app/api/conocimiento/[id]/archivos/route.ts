/**
 * Subir archivos a una base de conocimiento.
 *
 * Multipart con uno o varios archivos en el campo `archivos`. Responde al
 * instante con cuántos se aceptaron —cada uno ya es una fuente en «pendiente»—
 * y el aprendizaje (extraer el texto, trocear, indexar) sigue en segundo plano
 * con `after()`: la pantalla va viendo cómo cada archivo pasa a «lista».
 *
 * Es una ruta y no una Server Action porque las acciones tienen un tope de
 * cuerpo de 1 MB y un PDF de catálogo lo supera sin despeinarse.
 */
import { after } from "next/server";
import { tituloDesdeNombre } from "@strappy/rag";
import { conEspacio } from "@/lib/db/pool";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { aprenderArchivo, registrarPendiente } from "@/lib/conocimiento/aprender";
import { extensionDe } from "@/lib/conocimiento/extractores";
import { FORMATOS_ACEPTADOS, TAMANO_MAXIMO_MB, type RespuestaSubida } from "@/lib/conocimiento/tipos";

export const runtime = "nodejs";
// Extraer e indexar varios PDF grandes cabe de sobra; el tope protege de un bucle.
export const maxDuration = 300;

const PAPELES_QUE_EDITAN = new Set(["owner", "admin", "builder"]);

function error(mensaje: string, status: number): Response {
  return Response.json({ error: mensaje }, { status });
}

export async function POST(peticion: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: cerebroId } = await params;
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return error("Tu sesión terminó. Vuelve a entrar.", 401);
  if (!PAPELES_QUE_EDITAN.has(usuario.rol)) {
    return error("Tu papel en este espacio no permite cambiar el conocimiento.", 403);
  }
  if (!/^[0-9a-f-]{36}$/i.test(cerebroId)) return error("Esa base de conocimiento no existe.", 404);

  const existe = await conEspacio(usuario.workspaceId, async (scope) => {
    const { rows } = await scope.query(`select 1 from public.brains where workspace_id = $1 and id = $2`, [
      scope.workspaceId,
      cerebroId,
    ]);
    return rows.length > 0;
  });
  if (!existe) return error("Esa base de conocimiento no existe.", 404);

  let formulario: FormData;
  try {
    formulario = await peticion.formData();
  } catch {
    return error("No llegaron archivos. Vuelve a intentarlo.", 400);
  }

  const archivos = formulario.getAll("archivos").filter((v): v is File => v instanceof File);
  if (archivos.length === 0) return error("No llegaron archivos. Vuelve a intentarlo.", 400);

  const aceptados = new Set<string>(FORMATOS_ACEPTADOS.map((f) => f.slice(1)));
  const rechazados: { nombre: string; motivo: string }[] = [];
  const pendientes: { fuenteId: string; nombre: string; mimeType: string; bytes: Uint8Array }[] = [];

  for (const archivo of archivos) {
    const nombre = archivo.name || "archivo";
    if (!aceptados.has(extensionDe(nombre))) {
      rechazados.push({ nombre, motivo: "Formato no admitido. Sube PDF, Word, Excel, CSV o texto." });
      continue;
    }
    if (archivo.size > TAMANO_MAXIMO_MB * 1024 * 1024) {
      rechazados.push({ nombre, motivo: `Pesa más de ${TAMANO_MAXIMO_MB} MB.` });
      continue;
    }
    if (archivo.size === 0) {
      rechazados.push({ nombre, motivo: "El archivo está vacío." });
      continue;
    }
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const fuenteId = await registrarPendiente({
      workspaceId: usuario.workspaceId,
      cerebroId,
      usuarioId: usuario.id,
      kind: "file",
      titulo: tituloDesdeNombre(nombre),
      uri: nombre,
      mimeType: archivo.type || null,
      metadata: { tamano: archivo.size },
    });
    pendientes.push({ fuenteId, nombre, mimeType: archivo.type, bytes });
  }

  if (pendientes.length > 0) {
    after(async () => {
      // Uno detrás de otro: cada indexado abre su transacción y no hace falta
      // pelearse por el pool con diez PDF a la vez.
      for (const p of pendientes) {
        try {
          await aprenderArchivo(
            { workspaceId: usuario.workspaceId, cerebroId, fuenteId: p.fuenteId },
            { nombre: p.nombre, bytes: p.bytes, ...(p.mimeType ? { mimeType: p.mimeType } : {}) },
          );
        } catch (fallo) {
          console.error("[conocimiento] archivo", p.nombre, fallo);
        }
      }
    });
  }

  const cuerpo: RespuestaSubida = { recibidos: pendientes.length, rechazados };
  return Response.json(cuerpo, { status: 200 });
}
