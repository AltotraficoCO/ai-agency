/**
 * Arranca «Continuar con Google» con la app de Strappy. Ver lib/acceso/google.
 */
import { NextResponse } from "next/server";
import { appGoogle, destinoSeguro, urlDeAcceso } from "@/lib/acceso/google";
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
  return NextResponse.redirect(urlDeAcceso({ app, origen, siguiente }));
}
