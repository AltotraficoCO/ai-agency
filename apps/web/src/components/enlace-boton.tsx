"use client";

import Link from "next/link";
import { buttonVariants, cn } from "@strappy/ui";
import type { ButtonProps } from "@strappy/ui";

/**
 * Un enlace con aspecto de botón.
 *
 * No se usa `<Button asChild>` porque hoy no funciona: `Button` envuelve a sus
 * hijos en un `<span>` y añade un segundo hijo para el indicador de carga, así
 * que `Slot` recibe dos hijos y lanza «Slot failed to slot onto its children».
 * Arreglarlo es de `@strappy/ui`, que lleva otra corriente; mientras tanto se
 * reutilizan sus mismas variantes, que es lo que garantiza que se vean igual.
 *
 * Es de cliente porque `buttonVariants` vive en un módulo `"use client"` y una
 * función de ese lado no se puede llamar desde el servidor.
 */
export function EnlaceBoton({
  href,
  variant,
  size,
  className,
  children,
}: {
  href: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}
