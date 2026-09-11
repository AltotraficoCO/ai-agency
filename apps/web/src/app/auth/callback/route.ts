/**
 * Retorno del OAuth y de los enlaces por correo.
 *
 * Supabase devuelve un `code` de un solo uso; aquí se cambia por la sesión y se
 * escriben las cookies. Es la única ruta, aparte del middleware, que habla con
 * el SDK de autenticación.
 */
import { NextResponse } from "next/server";
import { crearClienteServidor, hayAutenticacionConfigurada } from "@/lib/supabase/servidor";

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const code = url.searchParams.get("code");
  const siguiente = url.searchParams.get("siguiente") ?? "/";
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/entrar?motivo=${encodeURIComponent(error)}`, url.origin),
    );
  }
  if (!code || !hayAutenticacionConfigurada()) {
    return NextResponse.redirect(new URL("/entrar", url.origin));
  }

  const supabase = await crearClienteServidor();
  const { error: fallo } = await supabase.auth.exchangeCodeForSession(code);
  if (fallo) {
    return NextResponse.redirect(
      new URL(`/entrar?motivo=${encodeURIComponent(fallo.message)}`, url.origin),
    );
  }

  // Solo rutas internas: un `siguiente` absoluto sería un redirector abierto.
  const destino = siguiente.startsWith("/") ? siguiente : "/";
  return NextResponse.redirect(new URL(destino, url.origin));
}
