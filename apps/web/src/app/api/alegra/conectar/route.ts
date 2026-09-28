/**
 * Manda al cliente a Alegra para que autorice a Strappy a consultar su cuenta
 * entera (nómina incluida).
 *
 * Se llega con un formulario GET, no con un `<Link>`: Next precarga los
 * enlaces y precargar esto sería registrar un cliente OAuth y abrir Alegra sin
 * que nadie lo pidiera.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { origenPublico } from "@/lib/canales/anuncios";
import { rutaDeVuelta, urlParaConectarAlegra } from "@/lib/contabilidad/alegra-completo";

export const dynamic = "force-dynamic";

const PAPELES_QUE_CONECTAN = new Set(["owner", "admin"]);

function error(origen: string, volver: string, detalle: string): URL {
  const url = new URL(volver, origen);
  url.searchParams.set("alegra", "error");
  url.searchParams.set("detalle", detalle);
  return url;
}

export async function GET(peticion: Request) {
  const origen = origenPublico(peticion);
  const volver = rutaDeVuelta(new URL(peticion.url).searchParams.get("volver"));

  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(volver)}`, origen));
  if (!PAPELES_QUE_CONECTAN.has(usuario.rol)) {
    return NextResponse.redirect(error(origen, volver, "Solo el propietario o un administrador pueden conectar Alegra."));
  }

  try {
    return NextResponse.redirect(
      await urlParaConectarAlegra({ workspaceId: usuario.workspaceId, userId: usuario.id, origen, volver }),
    );
  } catch (e) {
    console.error("[alegra] no se pudo empezar la autorización", e);
    return NextResponse.redirect(error(origen, volver, "Alegra no respondió al empezar la conexión. Vuelve a intentarlo en un momento."));
  }
}
