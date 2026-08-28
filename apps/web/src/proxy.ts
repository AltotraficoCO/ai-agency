/**
 * Refresco de sesión y puerta de la aplicación.
 *
 * Dos trabajos, y el orden importa: primero se refresca la cookie de sesión
 * —si no, un componente de servidor puede encontrarse un token caducado y
 * echar a alguien que sí había iniciado sesión—, y solo después se decide si
 * la ruta pedida necesita sesión.
 *
 * Es una de las cuatro excepciones a la regla de `lib/identidad.ts`: aquí se
 * habla con el SDK porque esto corre antes que cualquier otra cosa y es quien
 * tiene la respuesta y sus cookies en la mano.
 *
 * Se llama `proxy.ts` y no `middleware.ts` porque Next 16 renombró la
 * convención; `middleware` sigue funcionando pero avisa de que está obsoleta.
 */
import { claveDeNavegador } from "./lib/supabase/config";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Rutas que se ven sin haber entrado. Todo lo demás exige sesión. */
const PUBLICAS = ["/entrar", "/registro", "/recuperar", "/actualizar-clave", "/auth"];

export async function proxy(peticion: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = claveDeNavegador();

  // Sin Supabase configurado no hay sesión que refrescar ni puerta que cerrar:
  // es el modo de desarrollo local, donde `obtenerUsuarioActual()` devuelve la
  // cuenta sembrada. En producción estas variables existen siempre.
  if (!url || !anon) return NextResponse.next();

  let respuesta = NextResponse.next({ request: peticion });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return peticion.cookies.getAll();
      },
      setAll(nuevas) {
        for (const { name, value } of nuevas) peticion.cookies.set(name, value);
        respuesta = NextResponse.next({ request: peticion });
        for (const { name, value, options } of nuevas) respuesta.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = peticion.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  if (!user && !esPublica) {
    const destino = peticion.nextUrl.clone();
    destino.pathname = "/entrar";
    destino.searchParams.set("siguiente", ruta);
    return NextResponse.redirect(destino);
  }

  if (user && (ruta === "/entrar" || ruta === "/registro")) {
    const destino = peticion.nextUrl.clone();
    destino.pathname = "/agentes";
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  return respuesta;
}

export const config = {
  // Se excluyen los estáticos: pasar cada icono por aquí es gastar una llamada
  // de red a Supabase por cada archivo de la página.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
