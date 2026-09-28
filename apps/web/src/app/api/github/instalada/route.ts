/**
 * Vuelta de la instalación de la GitHub App.
 *
 * GitHub vuelve con `installation_id`, `setup_action`, `state` y —porque la App
 * pide autorización del usuario al instalarse— un `code`. El número de
 * instalación de la URL no prueba nada: cualquiera puede escribir el de otro.
 * Lo que lo prueba es canjear el `code` por un token del usuario y ver que esa
 * instalación está entre las suyas. Solo entonces se recuerda, en una cookie
 * cifrada, para que el formulario ofrezca sus repositorios.
 */
import { NextResponse } from "next/server";
import { configAppDesdeEnv, verificarInstalacion } from "@strappy/webmaster/github-app";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { origenPublico } from "@/lib/canales/anuncios";
import { leerEstadoInstalacion, recordarInstalacion, RUTA_SITIO } from "@/lib/sitio/repositorio";

export const dynamic = "force-dynamic";

function resultado(origen: string, volver: string, estado: "elige" | "error", detalle?: string): URL {
  const url = new URL(volver, origen);
  url.searchParams.set("github", estado);
  if (detalle) url.searchParams.set("detalle", detalle);
  return url;
}

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const origen = origenPublico(peticion);

  const state = url.searchParams.get("state");
  const estado = state ? leerEstadoInstalacion(state) : null;
  const volver = estado?.volver ?? RUTA_SITIO;

  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.redirect(new URL(`/entrar?siguiente=${encodeURIComponent(volver)}`, origen));
  if (!estado || estado.userId !== usuario.id || estado.workspaceId !== usuario.workspaceId) {
    return NextResponse.redirect(resultado(origen, volver, "error", "El enlace de instalación caducó o no es tuyo. Vuelve a intentarlo."));
  }

  const installationId = Number(url.searchParams.get("installation_id"));
  const code = url.searchParams.get("code");
  if (!Number.isInteger(installationId) || installationId <= 0 || !code) {
    return NextResponse.redirect(
      resultado(origen, volver, "error", "GitHub no completó la instalación. Si la cancelaste, vuelve a intentarlo cuando quieras."),
    );
  }

  const config = configAppDesdeEnv();
  if (!config) {
    return NextResponse.redirect(resultado(origen, volver, "error", "La GitHub App no está configurada en este servidor."));
  }

  let suya = false;
  try {
    suya = await verificarInstalacion(config, { code, installationId });
  } catch (error) {
    console.error("[github] no se pudo verificar la instalación", error);
  }
  if (!suya) {
    return NextResponse.redirect(
      resultado(origen, volver, "error", "No pudimos comprobar que esa instalación de GitHub es tuya. Vuelve a instalar la App."),
    );
  }

  await recordarInstalacion(usuario.workspaceId, installationId);
  return NextResponse.redirect(resultado(origen, volver, "elige"));
}
