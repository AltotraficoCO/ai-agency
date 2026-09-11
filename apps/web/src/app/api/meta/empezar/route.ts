/**
 * Empezar una conversación con Strap desde otra pantalla.
 *
 * Un botón como «Enseñarle mi negocio» no puede llevar a Inicio y dejar a la
 * persona delante de una caja vacía: tiene que abrir el hilo con la intención
 * ya escrita. Se crea el hilo aquí y se redirige a él con el mensaje de
 * apertura, igual que hacen los atajos de Inicio.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { crearHilo } from "@/lib/meta/borradores";

export const runtime = "nodejs";

const INTENCIONES: Record<string, { titulo: string; mensaje: string }> = {
  conocimiento: {
    titulo: "Enseñarle mi negocio",
    mensaje:
      "Quiero que mi agente de WhatsApp conozca mi negocio: mi catálogo, mis precios y lo que hay en mi web.",
  },
};

export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.redirect(new URL("/entrar", url));

  const intencion = INTENCIONES[url.searchParams.get("intencion") ?? ""];
  if (!intencion) return NextResponse.redirect(new URL("/", url));

  const id = await crearHilo({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    titulo: intencion.titulo,
  });

  const destino = new URL(`/c/${id}`, url);
  destino.searchParams.set("abrir", intencion.mensaje);
  return NextResponse.redirect(destino, 303);
}
