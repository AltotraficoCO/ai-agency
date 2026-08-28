/**
 * El turno de Strap por HTTP.
 *
 * La ruta hace tres cosas y ninguna más: comprueba quién eres, valida el
 * cuerpo y delega. Toda la lógica está en `lib/meta/strap.ts`, que se puede
 * leer y probar sin levantar un servidor.
 *
 * `hiloId` llega en el cuerpo, pero NO se confía: `actualizarHilo` y
 * `leerHilo` consultan siempre dentro del ámbito del espacio de trabajo del
 * usuario, así que pedir el hilo de otro cliente devuelve «no existe».
 */
import { z } from "zod";
import type { UIMessage } from "ai";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { responderTurnoDeStrap } from "@/lib/meta/strap";

export const runtime = "nodejs";
/** El auto-juego encadena varios turnos del motor; sesenta segundos se quedan cortos. */
export const maxDuration = 300;

const cuerpo = z.object({
  id: z.string().uuid().optional(),
  hiloId: z.string().uuid(),
  modo: z.enum(["lite", "max"]).default("lite"),
  messages: z.array(z.unknown()).min(1),
  respuestas: z
    .array(z.object({ clave: z.string().min(1), valores: z.array(z.string()).min(1) }))
    .optional(),
});

export async function POST(peticion: Request): Promise<Response> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return Response.json({ error: "No hay ninguna sesión iniciada." }, { status: 401 });
  }

  const leido = cuerpo.safeParse(await peticion.json());
  if (!leido.success) {
    return Response.json(
      { error: "La petición no tiene la forma esperada.", detalle: leido.error.issues },
      { status: 400 },
    );
  }

  try {
    return await responderTurnoDeStrap({
      usuario,
      hiloId: leido.data.hiloId,
      modo: leido.data.modo,
      mensajes: leido.data.messages as UIMessage[],
      ...(leido.data.respuestas ? { respuestas: leido.data.respuestas } : {}),
    });
  } catch (error) {
    console.error("[api/meta/chat]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Algo salió mal construyendo." },
      { status: 500 },
    );
  }
}
