/**
 * Entrar con Google.
 *
 * Va arriba y separado del formulario a propósito: para la mayoría de la gente
 * es un clic contra tres campos, y esconderlo debajo del formulario convierte
 * la opción rápida en la que nadie ve.
 *
 * El permiso lo pide la app de Strappy (ver lib/acceso/google), no Supabase:
 * así Google dice «strappy.io» y no el dominio técnico de Supabase. Formulario
 * GET y no enlace: un <Link> precargaría la ruta y abriría Google sin que
 * nadie lo pidiera.
 */
import { Button } from "@strappy/ui";

export function BotonGoogle({ siguiente = "/" }: { siguiente?: string }) {
  return (
    <form action="/api/auth/google/inicio" method="get">
      <input type="hidden" name="siguiente" value={siguiente} />
      <Button type="submit" variant="secondary" className="w-full">
        <LogoGoogle />
        Continuar con Google
      </Button>
    </form>
  );
}

function LogoGoogle() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3 0-5.6-2-6.6-4.8H1.4v3C3.4 21.4 7.4 24 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6v-3H1.4a12 12 0 0 0 0 10.6l4-3Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.7l4 3C6.4 6.8 9 4.8 12 4.8Z" />
    </svg>
  );
}
