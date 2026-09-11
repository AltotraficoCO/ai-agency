"use client";

/**
 * Las secciones de Ajustes.
 *
 * Antes cada sección era una página suelta a la que solo se llegaba desde el
 * avatar o desde un botón perdido en otra pantalla. Canales vive aquí desde que
 * salió del menú principal, y sin esta navegación nadie la encontraría.
 *
 * En escritorio es una columna con icono y una frase por sección: la persona
 * ve qué hay en cada una sin tener que entrar a mirar. En móvil se pliega a una
 * fila que se desplaza, para no empujar el contenido medio pantalla hacia abajo.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  Globe,
  MessageCircle,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { EncabezadoPagina, cn } from "@strappy/ui";

type Seccion = { href: string; etiqueta: string; descripcion: string; icono: LucideIcon };

const SECCIONES: readonly Seccion[] = [
  { href: "/ajustes/cuenta", etiqueta: "Cuenta", descripcion: "Tu perfil y tu sesión", icono: UserRound },
  { href: "/ajustes/espacio", etiqueta: "Espacio", descripcion: "Nombre, zona y horario", icono: Building2 },
  { href: "/ajustes/equipo", etiqueta: "Equipo", descripcion: "Quién entra y qué puede hacer", icono: Users },
  { href: "/ajustes/canales", etiqueta: "Canales", descripcion: "Tu número de WhatsApp", icono: MessageCircle },
  { href: "/ajustes/sitio", etiqueta: "Sitio web", descripcion: "El WordPress del Webmaster", icono: Globe },
  { href: "/ajustes/facturacion", etiqueta: "Facturación", descripcion: "Plan, consumo y pagos", icono: CreditCard },
];

function useSeccionActiva(): string {
  const pathname = usePathname() ?? "";
  return (
    SECCIONES.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))?.href ?? ""
  );
}

/**
 * El armazón de toda pantalla de Ajustes: navegación de secciones a la
 * izquierda, encabezado con la acción principal y el contenido a un ancho que
 * se lee, en vez de tarjetas diminutas flotando en medio de la pantalla.
 */
export function DisposicionAjustes({
  titulo,
  descripcion,
  acciones,
  ancho = "normal",
  children,
}: {
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  acciones?: React.ReactNode;
  /** `amplio` para pantallas con rejillas de tarjetas, como Facturación. */
  ancho?: "normal" | "amplio";
  children: React.ReactNode;
}) {
  const activa = useSeccionActiva();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-10 lg:py-8">
      <nav aria-label="Secciones de ajustes" className="lg:w-60 lg:shrink-0">
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:sticky lg:top-8 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
          {SECCIONES.map((seccion) => {
            const esActiva = seccion.href === activa;
            const Icono = seccion.icono;
            return (
              <li key={seccion.href} className="shrink-0">
                <Link
                  href={seccion.href}
                  aria-current={esActiva ? "page" : undefined}
                  className={cn(
                    "group flex cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-2",
                    "transition-colors duration-[var(--dur-fast)]",
                    esActiva
                      ? "border-border bg-raised text-fg shadow-e1"
                      : "border-transparent text-fg-secondary hover:bg-hover hover:text-fg",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-[var(--dur-fast)]",
                      esActiva
                        ? "bg-primary text-[var(--fg-on-brand)]"
                        : "bg-hover text-fg-muted group-hover:text-fg",
                    )}
                  >
                    <Icono size={16} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="whitespace-nowrap text-base font-medium">{seccion.etiqueta}</span>
                    <span className="hidden truncate text-2xs text-fg-muted lg:block">{seccion.descripcion}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-6",
          ancho === "amplio" ? "lg:max-w-4xl" : "lg:max-w-3xl",
        )}
      >
        <EncabezadoPagina titulo={titulo} descripcion={descripcion} acciones={acciones} />
        {children}
      </div>
    </div>
  );
}
