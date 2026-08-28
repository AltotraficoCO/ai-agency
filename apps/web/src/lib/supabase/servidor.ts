/**
 * Cliente de Supabase para el servidor (componentes de servidor, acciones y
 * manejadores de ruta).
 *
 * Lee y escribe la sesión en las cookies de la petición. NADIE fuera de
 * `lib/identidad.ts` y del middleware debería llamar a esto: ver el comentario
 * de aquel archivo.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function hayAutenticacionConfigurada(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function crearClienteServidor() {
  const almacen = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return almacen.getAll();
        },
        setAll(nuevas) {
          try {
            for (const { name, value, options } of nuevas) {
              almacen.set(name, value, options);
            }
          } catch {
            // Un componente de servidor no puede escribir cookies. No es un
            // fallo: el middleware ya refrescó la sesión antes de llegar aquí.
          }
        },
      },
    },
  );
}
