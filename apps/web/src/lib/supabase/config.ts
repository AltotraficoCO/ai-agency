/**
 * Configuración de Supabase, resuelta en un único sitio.
 *
 * Supabase renombró la `anon key` a `publishable key`, y el panel ya entrega el
 * nombre nuevo. Como es la misma clave, aquí se aceptan los dos: quien copie
 * del panel de hoy o de una guía de ayer obtiene lo mismo. Sin esto, el
 * síntoma es cruel — el botón de Google no hace nada y no explica por qué.
 */
export function claveDeNavegador(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function urlDeSupabase(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** ¿Está Supabase configurado? Si no, la aplicación debe decirlo, no fallar en silencio. */
export function haySupabase(): boolean {
  return Boolean(urlDeSupabase() && claveDeNavegador());
}

/** Igual que la anterior, pero falla con un mensaje que dice qué falta y dónde. */
export function exigirConfiguracion(): { url: string; clave: string } {
  const url = urlDeSupabase();
  const clave = claveDeNavegador();
  if (!url || !clave) {
    throw new Error(
      "Falta la configuración de Supabase en .env.local: NEXT_PUBLIC_SUPABASE_URL y " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (antes llamada NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }
  return { url, clave };
}
