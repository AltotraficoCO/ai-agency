/**
 * Abre el permiso de una plataforma de anuncios.
 *
 * Se llega aquí con un formulario GET desde Ajustes → Canales, no con un
 * `<Link>`: un enlace de Next precarga su destino y precargar esta ruta sería
 * abrir el diálogo de Google, de Meta o de TikTok sin que nadie lo pidiera.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import {
  esPlataformaDeAnuncios,
  RUTA_CANALES,
  origenPublico,
  rutaDeVuelta,
  urlDeConexion,
  urlDeResultado,
} from "@/lib/canales/anuncios";

export const dynamic = "force-dynamic";

const PAPELES_QUE_CONECTAN = new Set(["owner", "admin"]);

export async function GET(
  peticion: Request,
  { params }: { params: Promise<{ plataforma: string }> },
) {
  const origin = origenPublico(peticion);
  const { plataforma } = await params;
  // Desde dónde se pulsó «Conectar»: el asistente de contratación quiere que
  // la persona vuelva a su paso, no a Ajustes.
  const volver = rutaDeVuelta(new URL(peticion.url).searchParams.get("volver"));

  if (!esPlataformaDeAnuncios(plataforma)) {
    return NextResponse.redirect(urlDeResultado(origin, "error", "Esa plataforma de anuncios no existe.", volver));
  }

  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(volver)}`, origin));
  }
  if (!PAPELES_QUE_CONECTAN.has(usuario.rol)) {
    return NextResponse.redirect(
      urlDeResultado(
        origin,
        "error",
        "Solo el propietario o un administrador pueden conectar una cuenta de anuncios.",
        volver,
      ),
    );
  }

  const destino = urlDeConexion({
    plataforma,
    origen: origin,
    workspaceId: usuario.workspaceId,
    userId: usuario.id,
    volver,
  });
  if (!destino) {
    return NextResponse.redirect(
      urlDeResultado(origin, "error", "Esa plataforma todavía no está configurada en este servidor.", volver),
    );
  }
  return NextResponse.redirect(destino);
}
