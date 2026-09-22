import Link from "next/link";
import { Strap } from "@strappy/ui";

/**
 * Páginas legales: públicas, sin sesión y sin menú. Las enlazan Google, Meta y
 * TikTok al verificar la app, así que tienen que abrirse sin entrar.
 */
export default function LayoutLegal({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page px-4 py-10 text-fg">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-10 flex items-center gap-3">
          <Strap pose="saludando" size={44} />
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Strappy
          </Link>
          <nav className="ml-auto flex gap-4 text-sm text-fg-muted">
            <Link href="/policy" className="hover:text-fg">
              Privacidad
            </Link>
            <Link href="/terms" className="hover:text-fg">
              Términos
            </Link>
          </nav>
        </header>
        <article className="legal">{children}</article>
      </div>
    </div>
  );
}
