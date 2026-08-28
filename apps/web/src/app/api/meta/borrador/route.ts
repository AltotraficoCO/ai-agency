/**
 * El borrador, sin pasar por el modelo.
 *
 * Dos operaciones que NO son un turno de conversación:
 *
 *  · GET — la interfaz relee el borrador al terminar cada turno. Es lo que
 *    permite que las opciones ya contestadas se pinten colapsadas con un check
 *    aunque recargues la página.
 *
 *  · POST — corregir una línea del checklist. Editar «Se llama: Espiga» y que
 *    eso disparara un turno del modelo rompería el flujo por una errata. Se
 *    guarda y ya; Strap se entera la próxima vez que lea el borrador.
 */
import { z } from "zod";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { actualizarHilo, leerHilo } from "@/lib/meta/borradores";
import { respuestasAParcial } from "@/lib/meta/respuestas";

export const runtime = "nodejs";

const cuerpo = z.object({
  hiloId: z.string().uuid(),
  respuestas: z
    .array(z.object({ clave: z.string().min(1), valores: z.array(z.string()).min(1) }))
    .min(1),
});

export async function GET(peticion: Request): Promise<Response> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return Response.json({ error: "Sin sesión." }, { status: 401 });

  const hiloId = new URL(peticion.url).searchParams.get("hiloId") ?? "";
  const hilo = await leerHilo(usuario.workspaceId, hiloId);
  if (!hilo) return Response.json({ error: "Ese hilo no existe." }, { status: 404 });

  return Response.json({ fase: hilo.fase, borrador: hilo.borrador, titulo: hilo.titulo });
}

export async function POST(peticion: Request): Promise<Response> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return Response.json({ error: "Sin sesión." }, { status: 401 });

  const leido = cuerpo.safeParse(await peticion.json());
  if (!leido.success) {
    return Response.json({ error: "La petición no tiene la forma esperada." }, { status: 400 });
  }

  try {
    const hilo = await actualizarHilo(usuario.workspaceId, leido.data.hiloId, {
      borrador: respuestasAParcial(leido.data.respuestas),
    });
    return Response.json({ fase: hilo.fase, borrador: hilo.borrador });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar." },
      { status: 400 },
    );
  }
}
