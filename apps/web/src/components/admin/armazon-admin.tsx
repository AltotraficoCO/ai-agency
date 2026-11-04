"use client";

/**
 * El armazón del panel: el mismo de la aplicación, con otro menú.
 *
 * El `Sidebar` de `@strappy/ui` está atado a los destinos de un espacio, así que
 * aquí se monta el menú del panel con sus mismas medidas, marca, estados y
 * plegado. Quien entra tiene que sentir que sigue en Strappy.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChartColumn, CreditCard, PanelLeftClose, PanelLeftOpen, Users, type LucideIcon } from "lucide-react";
import { Avatar, BotonTema, IconButton, Marca, MenuMovil, Tooltip, Topbar, cn, useMenuColapsado } from "@strappy/ui";

type Seccion = { href: string; etiqueta: string; icono: LucideIcon; exacta?: boolean };

const SECCIONES: readonly Seccion[] = [
  { href: "/admin", etiqueta: "Ventas", icono: ChartColumn, exacta: true },
  { href: "/admin/clientes", etiqueta: "Clientes", icono: Users },
  { href: "/admin/cobro", etiqueta: "Cobro", icono: CreditCard },
];

const VOLVER: Seccion = { href: "/app", etiqueta: "Volver a la app", icono: ArrowLeft };

function esActiva(seccion: Seccion, ruta: string): boolean {
  return seccion.exacta ? ruta === seccion.href : ruta === seccion.href || ruta.startsWith(`${seccion.href}/`);
}

function EnlaceMenu({ seccion, activo }: { seccion: Seccion; activo: boolean }) {
  const Icono = seccion.icono;
  return (
    <Link
      href={seccion.href}
      aria-current={activo ? "page" : undefined}
      className={cn(
        "group relative flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-3 text-base font-semibold",
        "transition-[color,background-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]",
        "active:scale-x-[1.02] active:scale-y-[0.94] motion-reduce:active:scale-100",
        activo ? "bg-selected text-primary-fg shadow-e1" : "text-fg-secondary hover:translate-x-0.5 hover:bg-hover hover:text-fg",
      )}
    >
      <Icono size={18} strokeWidth={1.75} aria-hidden className={cn("shrink-0", activo && "text-primary-fg")} />
      <span className="truncate">{seccion.etiqueta}</span>
    </Link>
  );
}

function IconoMenu({ seccion, activo }: { seccion: Seccion; activo: boolean }) {
  const Icono = seccion.icono;
  return (
    <Tooltip content={seccion.etiqueta} side="right">
      <Link
        href={seccion.href}
        aria-label={seccion.etiqueta}
        aria-current={activo ? "page" : undefined}
        className={cn(
          "relative grid size-10 cursor-pointer place-items-center rounded-md transition-colors duration-[var(--dur-fast)]",
          activo ? "bg-selected text-primary-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
          activo &&
            "before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary",
        )}
      >
        <Icono size={18} strokeWidth={1.75} aria-hidden />
      </Link>
    </Tooltip>
  );
}

function MenuAdmin({
  correo,
  ruta,
  colapsado = false,
  onAlternar,
  className,
}: {
  correo: string;
  ruta: string;
  colapsado?: boolean;
  onAlternar?: () => void;
  className?: string;
}) {
  if (colapsado) {
    return (
      <nav
        aria-label="Navegación del panel"
        className="flex h-full w-16 shrink-0 flex-col items-center border-r border-border bg-nav"
      >
        <div className="flex h-[52px] shrink-0 items-center">
          <Tooltip content="Desplegar el menú" side="right">
            <IconButton label="Desplegar el menú" size="sm" onClick={onAlternar} className="cursor-pointer">
              <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 py-1">
          {SECCIONES.map((s) => (
            <IconoMenu key={s.href} seccion={s} activo={esActiva(s, ruta)} />
          ))}
          <span aria-hidden className="my-1.5 h-px w-7 bg-[var(--border-subtle)]" />
          <IconoMenu seccion={VOLVER} activo={false} />
        </div>
        <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-[var(--border-subtle)] py-2">
          <BotonTema className="size-10 cursor-pointer" />
          <Avatar name={correo} size="md" tone="humano" />
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Navegación del panel"
      className={cn("flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-nav", className)}
    >
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 pl-3 pr-2">
        <Marca />
        {onAlternar ? (
          <Tooltip content="Plegar el menú" side="right">
            <IconButton label="Plegar el menú" size="sm" onClick={onAlternar} className="cursor-pointer">
              <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        <p className="px-3 pb-1 pt-2 text-2xs font-medium tracking-wide text-fg-muted uppercase">Super admin</p>
        {SECCIONES.map((s) => (
          <EnlaceMenu key={s.href} seccion={s} activo={esActiva(s, ruta)} />
        ))}
        <hr className="my-3 border-0 border-t border-[var(--border-subtle)]" />
        <EnlaceMenu seccion={VOLVER} activo={false} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border-subtle)] p-2">
        <div className="flex items-center justify-between gap-1 pl-2">
          <span className="text-sm text-fg-secondary">Tema</span>
          <BotonTema className="cursor-pointer" />
        </div>
        <div className="flex h-11 items-center gap-2.5 rounded-md px-2">
          <Avatar name={correo} size="md" tone="humano" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-fg">Super admin</span>
            <span className="truncate text-2xs text-fg-muted">{correo}</span>
          </span>
        </div>
      </div>
    </nav>
  );
}

function BotonMenuMovil({ correo, ruta }: { correo: string; ruta: string }) {
  const [abierto, setAbierto] = React.useState(false);
  const [rutaVista, setRutaVista] = React.useState(ruta);
  // Al navegar desde el menú móvil, se cierra solo.
  if (rutaVista !== ruta) {
    setRutaVista(ruta);
    setAbierto(false);
  }
  return (
    <MenuMovil abierto={abierto} onAbiertoCambia={setAbierto}>
      <MenuAdmin correo={correo} ruta={ruta} className="w-full" />
    </MenuMovil>
  );
}

function tituloDe(ruta: string): { titulo: string; detalle: boolean } {
  const seccion = SECCIONES.find((s) => esActiva(s, ruta));
  return { titulo: seccion?.etiqueta ?? "Super admin", detalle: ruta.startsWith("/admin/clientes/") };
}

export function ArmazonAdmin({ correo, children }: { correo: string; children: React.ReactNode }) {
  const ruta = usePathname() ?? "/admin";
  const [colapsado, alternar] = useMenuColapsado();
  const { titulo, detalle } = tituloDe(ruta);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-page">
      <div className="hidden h-full md:flex">
        <MenuAdmin correo={correo} ruta={ruta} colapsado={colapsado} onAlternar={alternar} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          inicio={<BotonMenuMovil correo={correo} ruta={ruta} />}
          contexto="Super admin"
          titulo={detalle ? "Detalle del cliente" : titulo}
        />
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
