/**
 * Vuelta de la autorización de Alegra.
 *
 * Alegra redirige aquí con un código de un solo uso. Canjearlo, comprobar que
 * el acceso deja consultar la cuenta y guardarlo pasa todo en esta petición, y
 * el navegador vuelve a Contabilidad con el resultado.
 */
import { NextResponse } from "next/server";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { origenPublico } from "@/lib/canales/anuncios";
import { completarConexionAlegra, leerEstadoAlegra, RUTA_CONTABILIDAD } from "@/lib/contabilidad/alegra-completo";

export const dynamic = "force-dynamic";

function resultado(origen: string, volver: string, estado: "ok" | "error", detalle: string): URL {
  const url = new URL(volver, origen);
  url.searchParams.set("alegra", estado);
  url.searchParams.set("detalle", detalle);
  return url;
}

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const origen = origenPublico(peticion);
  const state = url.searchParams.get("state");
  const estado = state ? leerEstadoAlegra(state) : null;
  const volver = estado?.volver ?? RUTA_CONTABILIDAD;

  const cancelado = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (cancelado) return NextResponse.redirect(resultado(origen, volver, "error", `Alegra no completó la conexión: ${cancelado}`));

  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(volver)}`, origen));
  // El `state` va cifrado y tiene que ser de esta persona y de este espacio.
  if (!estado || estado.userId !== usuario.id || estado.workspaceId !== usuario.workspaceId) {
    return NextResponse.redirect(resultado(origen, volver, "error", "El enlace de conexión caducó o no es tuyo. Vuelve a intentarlo."));
  }
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(resultado(origen, volver, "error", "Alegra no devolvió el código de autorización."));

  let r;
  try {
    r = await completarConexionAlegra({ estado, code, origen, usuarioId: usuario.id });
  } catch (e) {
    console.error("[alegra] fallo inesperado al conectar", e);
    r = { ok: false as const, mensaje: "Algo falló de nuestro lado al guardar la conexión. Vuelve a intentarlo." };
  }
  return NextResponse.redirect(
    r.ok
      ? resultado(origen, volver, "ok", `Tu cuenta de Alegra quedó conectada: el agente ya puede consultar ${r.consultas} tipos de información, nómina incluida.`)
      : resultado(origen, volver, "error", r.mensaje),
  );
}
