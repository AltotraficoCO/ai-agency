"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@strappy/ui";

const SECCIONES = [
  { href: "/admin", etiqueta: "Ventas", exacta: true },
  { href: "/admin/clientes", etiqueta: "Clientes", exacta: false },
  { href: "/admin/cobro", etiqueta: "Cobro", exacta: false },
];

export function NavAdmin() {
  const ruta = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="flex items-center gap-1">
      {SECCIONES.map((s) => {
        const activa = s.exacta ? ruta === s.href : ruta.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={activa ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors duration-[var(--dur-fast)]",
              activa ? "bg-primary-soft font-medium text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
            )}
          >
            {s.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
