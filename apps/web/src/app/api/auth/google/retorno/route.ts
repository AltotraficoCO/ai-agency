/**
 * Vuelta de Google: el código se cambia por el id_token y Supabase crea la
 * sesión con él. Es la segunda ruta, con /auth/callback, que habla con el SDK
 * de autenticación. Ver lib/acceso/google.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_VINCULO, appGoogle, canjearCodigo, leerEstado } from "@/lib/acceso/google";
import { origenPublico } from "@/lib/canales/anuncios";
import { crearClienteServidor, hayAutenticacionConfigurada } from "@/lib/supabase/servidor";

function aEntrar(origen: string, motivo: string): NextResponse {
  return NextResponse.redirect(new URL(`/entrar?motivo=${encodeURIComponent(motivo)}`, origen));
}

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const origen = origenPublico(peticion);

  const cancelado = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (cancelado) return aEntrar(origen, `Google no completó el acceso: ${cancelado}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const app = appGoogle();
  if (!code || !state || !app || !hayAutenticacionConfigurada()) {
    return aEntrar(origen, "Google no devolvió el código de acceso. Vuelve a intentarlo.");
  }
  // El retorno solo vale en el navegador que empezó el flujo.
  const vinculo = (await cookies()).get(COOKIE_VINCULO)?.value;
  const estado = leerEstado(state, vinculo);
  if (!estado) return aEntrar(origen, "El enlace de acceso caducó o no se abrió desde este navegador. Vuelve a intentarlo.");

  let idToken: string;
  try {
    idToken = await canjearCodigo({ app, code, origen });
  } catch (error) {
    return aEntrar(origen, error instanceof Error ? error.message : "Google no completó el acceso.");
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken, nonce: estado.nonce });
  if (error) return aEntrar(origen, error.message);

  const respuesta = NextResponse.redirect(new URL(estado.siguiente, origen));
  respuesta.cookies.delete({ name: COOKIE_VINCULO, path: "/api/auth/google" });
  return respuesta;
}
