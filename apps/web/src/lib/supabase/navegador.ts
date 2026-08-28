/**
 * Cliente de Supabase para el navegador.
 *
 * Solo lo usan los formularios de acceso (`app/(acceso)`) y el botón de cerrar
 * sesión. El resto de la aplicación nunca habla con el SDK: pide el usuario a
 * `obtenerUsuarioActual()`.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
