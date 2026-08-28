/**
 * El simulador, por SSE.
 *
 * El motor usa `generateText`, no `streamText`: la respuesta llega entera. Lo
 * que se transmite entonces no son fragmentos de texto sino ETAPAS —recibido,
 * pensando, respuesta, cobro—, que es lo que de verdad quiere ver quien está
 * probando su agente: si está pensando, cuánto tardó y cuánto costó.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { enviarMensaje } from "@/lib/motor/simulador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cuerpo = { conversationId?: string; texto?: string };

export async function POST(peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await ctx.params;
  const usuario = await exigirUsuarioActual();
  const cuerpo = (await peticion.json()) as Cuerpo;

  const texto = (cuerpo.texto ?? "").trim();
  const conversationId = cuerpo.conversationId ?? "";
  if (!texto || !conversationId) {
    return Response.json({ error: "Faltan el texto o la conversación." }, { status: 400 });
  }

  const codificador = new TextEncoder();
  const flujo = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const emitir = (evento: string, datos: unknown) => {
        controlador.enqueue(
          codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`),
        );
      };

      const inicio = Date.now();
      emitir("recibido", { texto });
      emitir("pensando", {});

      try {
        const resultado = await enviarMensaje({
          workspaceId: usuario.workspaceId,
          agentId,
          conversationId,
          texto,
        });
        emitir("resultado", { ...resultado, milisegundos: Date.now() - inicio });
      } catch (error) {
        emitir("error", {
          mensaje: error instanceof Error ? error.message : "Algo salió mal en el simulador.",
        });
      } finally {
        emitir("fin", {});
        controlador.close();
      }
    },
  });

  return new Response(flujo, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
