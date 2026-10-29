/**
 * Arranca «Continuar con Google» con la app de Strappy. Ver lib/acceso/google.
 */
import { NextResponse } from "next/server";
import { COOKIE_VINCULO, appGoogle, destinoSeguro, nuevoVinculo, urlDeAcceso } from "@/lib/acceso/google";
import { origenPublico } from "@/lib/canales/anuncios";

export async function GET(peticion: Request) {
  const origen = origenPublico(peticion);
  const siguiente = destinoSeguro(new URL(peticion.url).searchParams.get("siguiente"));
  const app = appGoogle();
  if (!app) {
    return NextResponse.redirect(
      new URL(`/entrar?motivo=${encodeURIComponent("El acceso con Google no está configurado en este servidor.")}`, origen),
    );
  }
  const vinculo = nuevoVinculo();
  const respuesta = NextResponse.redirect(urlDeAcceso({ app, origen, siguiente, vinculo }));
  respuesta.cookies.set(COOKIE_VINCULO, vinculo, {
    httpOnly: true,
    sameSite: "lax",
    secure: origen.startsWith("https://"),
    path: "/api/auth/google",
    maxAge: 600,
  });
  return respuesta;
}
