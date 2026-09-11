/**
 * Vuelta del alta de WhatsApp.
 *
 * Meta redirige aquí con un `code` de un solo uso que caduca en segundos. Todo
 * el trabajo —canjearlo, encontrar la cuenta, registrar el número— ocurre en
 * esta misma petición y el navegador vuelve a Canales con el resultado.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import {
  completarConexion,
  leerEstadoOAuth,
  RUTA_CANALES,
  urlDeResultado,
  type ResultadoConexion,
} from "@/lib/canales/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const { origin } = url;

  // Quien cierra el diálogo o no concede permisos vuelve con `error`, no con `code`.
  const cancelado =
    url.searchParams.get("error_description") ??
    url.searchParams.get("error_reason") ??
    url.searchParams.get("error");
  if (cancelado) {
    return NextResponse.redirect(urlDeResultado(origin, "error", `Meta no completó la conexión: ${cancelado}`));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(urlDeResultado(origin, "error", "Meta no devolvió el código de autorización."));
  }

  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(RUTA_CANALES)}`, origin));
  }

  // El `state` va cifrado; además tiene que ser de esta persona y de este espacio.
  const estado = leerEstadoOAuth(state);
  if (!estado || estado.userId !== usuario.id || estado.workspaceId !== usuario.workspaceId) {
    return NextResponse.redirect(
      urlDeResultado(origin, "error", "El enlace de conexión caducó o no es tuyo. Vuelve a intentarlo."),
    );
  }

  let resultado: ResultadoConexion;
  try {
    resultado = await completarConexion({ origen: origin, code, workspaceId: usuario.workspaceId });
  } catch (error) {
    console.error("[whatsapp] fallo inesperado al conectar", error);
    resultado = { ok: false, mensaje: "Algo falló de nuestro lado al guardar la conexión. Vuelve a intentarlo." };
  }

  return NextResponse.redirect(
    resultado.ok
      ? urlDeResultado(origin, "ok", resultado.numero)
      : urlDeResultado(origin, "error", resultado.mensaje),
  );
}
