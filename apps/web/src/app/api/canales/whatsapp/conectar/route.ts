/**
 * Abre el alta de WhatsApp en Meta.
 *
 * Se llega aquí con un formulario GET desde Ajustes → Canales, no con un
 * `<Link>`: un enlace de Next precarga su destino y precargar esta ruta sería
 * abrir un diálogo de Meta que nadie pidió.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { RUTA_CANALES, urlDeConexion, urlDeResultado } from "@/lib/canales/whatsapp";

export const dynamic = "force-dynamic";

const PAPELES_QUE_CONECTAN = new Set(["owner", "admin"]);

export async function GET(peticion: Request) {
  const { origin } = new URL(peticion.url);

  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(RUTA_CANALES)}`, origin));
  }
  if (!PAPELES_QUE_CONECTAN.has(usuario.rol)) {
    return NextResponse.redirect(
      urlDeResultado(origin, "error", "Solo el propietario o un administrador pueden conectar WhatsApp."),
    );
  }

  const destino = urlDeConexion({ origen: origin, workspaceId: usuario.workspaceId, userId: usuario.id });
  if (!destino) {
    return NextResponse.redirect(
      urlDeResultado(origin, "error", "Falta configurar la app de Meta en el servidor."),
    );
  }
  return NextResponse.redirect(destino);
}
