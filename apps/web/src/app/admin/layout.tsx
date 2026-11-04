/**
 * El panel de super admin. Fuera del grupo `(aplicacion)` a propósito: no mira un
 * espacio, sino a todos, y no debe parecer que se está dentro de uno.
 *
 * Esta comprobación no basta por sí sola: cada página y cada acción repiten la
 * suya, porque un layout no se vuelve a ejecutar al navegar.
 */
import Link from "next/link";
import { NavAdmin } from "@/components/admin/nav-admin";
import { exigirSuperAdmin } from "@/lib/plataforma/acceso";

export const metadata = { title: "Super admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const admin = await exigirSuperAdmin();
  return (
    <div className="h-dvh overflow-y-auto bg-page">
      <header className="sticky top-0 z-10 border-b border-border bg-raised">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/admin" className="text-base font-semibold tracking-tight text-fg">
            Strappy · Super admin
          </Link>
          <NavAdmin />
          <div className="ml-auto flex items-center gap-3 text-sm text-fg-muted">
            <span className="hidden sm:inline">{admin.correo}</span>
            <Link href="/app" className="text-fg-secondary underline-offset-2 hover:underline">
              Volver a la app
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
