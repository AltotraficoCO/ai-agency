import { NextResponse } from "next/server";
import { crearClienteServidor, hayAutenticacionConfigurada } from "@/lib/supabase/servidor";

/** Cerrar sesión. Va por POST: un GET lo dispararía cualquier `<img>`. */
export async function POST(peticion: Request) {
  if (hayAutenticacionConfigurada()) {
    const supabase = await crearClienteServidor();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/entrar", new URL(peticion.url).origin), { status: 303 });
}
