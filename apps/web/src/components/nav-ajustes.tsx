"use client";

/**
 * Las secciones de Ajustes.
 *
 * Antes cada sección era una página suelta a la que solo se llegaba desde el
 * avatar o desde un botón perdido en otra pantalla. Canales vive aquí desde que
 * salió del menú principal, y sin esta barra nadie la encontraría.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@strappy/ui";

const SECCIONES = [
  { href: "/ajustes/cuenta", etiqueta: "Cuenta" },
  { href: "/ajustes/espacio", etiqueta: "Espacio" },
  { href: "/ajustes/equipo", etiqueta: "Equipo" },
  { href: "/ajustes/canales", etiqueta: "Canales" },
  { href: "/ajustes/sitio", etiqueta: "Sitio web" },
  { href: "/ajustes/facturacion", etiqueta: "Facturación" },
] as const;

export function NavAjustes() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Secciones de ajustes" className="border-b border-[var(--border-subtle)] px-6">
      <ul className="mx-auto flex max-w-3xl gap-1 overflow-x-auto">
        {SECCIONES.map((seccion) => {
          const activa = pathname === seccion.href || pathname.startsWith(`${seccion.href}/`);
          return (
            <li key={seccion.href}>
              <Link
                href={seccion.href}
                aria-current={activa ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center whitespace-nowrap px-3 text-base font-medium text-fg-secondary",
                  "transition-colors duration-[var(--dur-instant)] hover:text-fg",
                  activa &&
                    "text-fg after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
                )}
              >
                {seccion.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
