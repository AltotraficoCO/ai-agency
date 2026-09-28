/**
 * Manda al cliente a instalar la GitHub App de Strappy en su cuenta.
 *
 * Se llega con un formulario GET, no con un `<Link>`: Next precarga los
 * enlaces y precargar esto sería abrir GitHub sin que nadie lo pidiera.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { origenPublico } from "@/lib/canales/anuncios";
import { rutaDeVuelta, urlParaInstalar } from "@/lib/sitio/repositorio";

export const dynamic = "force-dynamic";

const PAPELES_QUE_CONECTAN = new Set(["owner", "admin"]);

function vuelta(origen: string, volver: string, error: string): URL {
  const url = new URL(volver, origen);
  url.searchParams.set("github", "error");
  url.searchParams.set("detalle", error);
  return url;
}

export async function GET(peticion: Request) {
  const origen = origenPublico(peticion);
  const volver = rutaDeVuelta(new URL(peticion.url).searchParams.get("volver"));

  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(volver)}`, origen));
  if (!PAPELES_QUE_CONECTAN.has(usuario.rol)) {
    return NextResponse.redirect(vuelta(origen, volver, "Solo el propietario o un administrador pueden conectar el repositorio."));
  }

  const destino = urlParaInstalar({ workspaceId: usuario.workspaceId, userId: usuario.id, volver });
  if (!destino) {
    return NextResponse.redirect(vuelta(origen, volver, "La GitHub App no está configurada en este servidor. Conecta con un token."));
  }
  return NextResponse.redirect(destino);
}
