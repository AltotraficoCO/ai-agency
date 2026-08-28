/**
 * Todo lo que se le hace a una conversación que no es escribir en ella.
 *
 * Una sola ruta con una unión discriminada en vez de nueve rutas de seis
 * líneas: las acciones comparten identidad, permisos y forma de respuesta, y
 * partirlas en nueve archivos multiplicaría ese preámbulo por nueve.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import {
  asignar,
  cerrar,
  crearNota,
  devolverControl,
  etiquetar,
  marcarLeida,
  pausarIA,
  posponer,
  resumirParaLaIA,
  solicitarControl,
  tomarControl,
  usarRespuestaRapida,
  type ResultadoAccion,
} from "@/lib/bandeja/acciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cuerpo =
  | { tipo: "tomar-control" }
  | { tipo: "devolver-control"; resumen?: string }
  | { tipo: "pausar-ia"; minutos?: number }
  | { tipo: "solicitar-control" }
  | { tipo: "asignar"; usuarioId?: string | null }
  | { tipo: "posponer"; hasta?: string | null }
  | { tipo: "cerrar" }
  | { tipo: "reabrir" }
  | { tipo: "marcar-leida" }
  | { tipo: "etiquetar"; etiquetaId: string; poner: boolean }
  | { tipo: "nota"; texto: string; menciones?: string[] }
  | { tipo: "resumir" }
  | { tipo: "usar-respuesta"; respuestaId: string };

export async function POST(peticion: Request, params: { params: Promise<{ id: string }> }) {
  const { id } = await params.params;
  const usuario = await exigirUsuarioActual();
  const cuerpo = (await peticion.json()) as Cuerpo;
  const ctx = {
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    conversacionId: id,
  };

  let resultado: ResultadoAccion;

  switch (cuerpo.tipo) {
    case "tomar-control":
      resultado = await tomarControl(ctx);
      break;
    case "devolver-control":
      resultado = await devolverControl(ctx, cuerpo.resumen ? { resumen: cuerpo.resumen } : {});
      break;
    case "pausar-ia":
      resultado = await pausarIA(ctx, cuerpo.minutos ?? 60);
      break;
    case "solicitar-control":
      resultado = await solicitarControl(ctx);
      break;
    case "asignar":
      resultado = await asignar(ctx, cuerpo.usuarioId ?? null);
      break;
    case "posponer":
      resultado = await posponer(ctx, cuerpo.hasta ?? null);
      break;
    case "cerrar":
      resultado = await cerrar(ctx, false);
      break;
    case "reabrir":
      resultado = await cerrar(ctx, true);
      break;
    case "marcar-leida":
      resultado = await marcarLeida(ctx);
      break;
    case "etiquetar":
      resultado = await etiquetar(ctx, cuerpo.etiquetaId, cuerpo.poner);
      break;
    case "nota":
      resultado = await crearNota(ctx, {
        texto: cuerpo.texto ?? "",
        menciones: cuerpo.menciones ?? [],
      });
      break;
    case "resumir":
      resultado = await resumirParaLaIA(ctx);
      break;
    case "usar-respuesta":
      await usarRespuestaRapida({ workspaceId: usuario.workspaceId, id: cuerpo.respuestaId });
      resultado = { ok: true };
      break;
    default:
      return Response.json({ error: "No sé hacer eso." }, { status: 400 });
  }

  return Response.json(resultado, { status: resultado.ok ? 200 : 409 });
}
