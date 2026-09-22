/**
 * Vuelta del permiso de una plataforma de anuncios.
 *
 * La plataforma redirige aquí con un código de un solo uso que caduca en
 * segundos: canjearlo, comprobar que hay cuentas detrás y guardar la conexión
 * ocurre todo en esta misma petición, y el navegador vuelve a Canales con el
 * resultado.
 */
import { NextResponse } from "next/server";
import { NOMBRE_PLATAFORMA } from "@strappy/marketing";
import { obtenerUsuarioActual } from "@/lib/identidad";
import {
  completarConexion,
  esPlataformaDeAnuncios,
  leerEstado,
  origenPublico,
  RUTA_CANALES,
  urlDeResultado,
  type ResultadoConexion,
} from "@/lib/canales/anuncios";

export const dynamic = "force-dynamic";

export async function GET(
  peticion: Request,
  { params }: { params: Promise<{ plataforma: string }> },
) {
  const url = new URL(peticion.url);
  const origin = origenPublico(peticion);
  const { plataforma } = await params;

  if (!esPlataformaDeAnuncios(plataforma)) {
    return NextResponse.redirect(urlDeResultado(origin, "error", "Esa plataforma de anuncios no existe."));
  }

  // Quien cierra el diálogo o no concede permisos vuelve con `error`, no con
  // código. TikTok no usa `error` sino `auth_code` ausente, así que se mira todo.
  const cancelado =
    url.searchParams.get("error_description") ??
    url.searchParams.get("error_reason") ??
    url.searchParams.get("error");
  if (cancelado) {
    return NextResponse.redirect(
      urlDeResultado(origin, "error", `${NOMBRE_PLATAFORMA[plataforma]} no completó la conexión: ${cancelado}`),
    );
  }

  // Google y Meta lo llaman `code`; TikTok, `auth_code`.
  const code = url.searchParams.get("code") ?? url.searchParams.get("auth_code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(
      urlDeResultado(
        origin,
        "error",
        `${NOMBRE_PLATAFORMA[plataforma]} no devolvió el código de autorización.`,
      ),
    );
  }

  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(RUTA_CANALES)}`, origin));
  }

  // El `state` va cifrado; además tiene que ser de esta persona, de este
  // espacio y de la MISMA plataforma por la que volvió.
  const estado = leerEstado(state);
  if (
    !estado ||
    estado.userId !== usuario.id ||
    estado.workspaceId !== usuario.workspaceId ||
    estado.plataforma !== plataforma
  ) {
    return NextResponse.redirect(
      urlDeResultado(origin, "error", "El enlace de conexión caducó o no es tuyo. Vuelve a intentarlo."),
    );
  }

  let resultado: ResultadoConexion;
  try {
    resultado = await completarConexion({
      origen: origin,
      plataforma,
      code,
      workspaceId: usuario.workspaceId,
      usuarioId: usuario.id,
    });
  } catch (error) {
    console.error("[anuncios] fallo inesperado al conectar", error);
    resultado = {
      ok: false,
      mensaje: "Algo falló de nuestro lado al guardar la conexión. Vuelve a intentarlo.",
    };
  }

  return NextResponse.redirect(
    resultado.ok
      ? urlDeResultado(
          origin,
          "ok",
          `${NOMBRE_PLATAFORMA[resultado.plataforma]}·${resultado.cuentas}`,
        )
      : urlDeResultado(origin, "error", resultado.mensaje),
  );
}
