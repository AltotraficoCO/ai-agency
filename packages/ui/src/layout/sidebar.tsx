"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { Avatar } from "../components/avatar";
import { Tooltip } from "../components/tooltip";
import { CreditsWidget, type CreditsWidgetProps } from "./credits-widget";
import {
  destinoAjustes,
  destinoContratar,
  destinosPrincipales,
  esGrupoNav,
  etiquetaEstadoCanal,
  menuPrincipal,
  type DestinoNav,
  type EstadoCanal,
  type Ruta,
} from "./navigation";

export interface UsuarioSidebar {
  nombre: string;
  correo: string;
  avatar?: string;
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  /** Ruta activa; se compara contra el array tipado de destinos. */
  rutaActiva: Ruta;
  /** Conversaciones sin atender en la bandeja. */
  pendientes?: number;
  estadoCanales?: EstadoCanal;
  usuario: UsuarioSidebar;
  creditos: Omit<CreditsWidgetProps, "colapsado">;
  /** Componente de enlace de la app (por ejemplo `next/link`). */
  linkComponent?: React.ElementType;
  onUsuarioClick?: () => void;
}

const puntoEstado: Record<EstadoCanal, string> = {
  conectado: "bg-success",
  revisar: "bg-warning",
  caido: "bg-danger",
};

interface DestinoLinkProps {
  destino: DestinoNav;
  activo: boolean;
  pendientes?: number;
  estadoCanales?: EstadoCanal;
  linkComponent: React.ElementType;
}

function DestinoLink({ destino, activo, pendientes, estadoCanales, linkComponent }: DestinoLinkProps) {
  const Link = linkComponent;
  const Icono = destino.icono;

  return (
    <Link
      href={destino.href}
      aria-current={activo ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base font-medium",
        "transition-colors duration-[var(--dur-instant)]",
        activo
          ? "bg-selected text-fg"
          : "text-fg-secondary hover:bg-hover hover:text-fg",
        destino.destacado && !activo && "text-primary-fg hover:bg-primary-soft",
        focusRing,
      )}
    >
      <Icono
        size={18}
        strokeWidth={1.75}
        aria-hidden
        className={cn("shrink-0", activo && "text-primary-fg")}
      />
      <span className="truncate">{destino.etiqueta}</span>

      {destino.indicador === "contador" && pendientes ? (
        <span className="tnum ml-auto rounded-full bg-primary px-1.5 py-px text-2xs font-semibold text-[var(--fg-on-brand)]">
          {pendientes > 99 ? "99+" : pendientes}
          <span className="sr-only"> conversaciones sin atender</span>
        </span>
      ) : null}

      {destino.indicador === "estado" && estadoCanales ? (
        <span className="ml-auto flex items-center" title={etiquetaEstadoCanal[estadoCanales]}>
          <span className={cn("size-1.5 rounded-full", puntoEstado[estadoCanales])} />
          <span className="sr-only">{etiquetaEstadoCanal[estadoCanales]}</span>
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({
  rutaActiva,
  pendientes,
  estadoCanales,
  usuario,
  creditos,
  linkComponent = "a",
  onUsuarioClick,
  className,
  ...props
}: SidebarProps) {
  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-nav",
        className,
      )}
      {...props}
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
        <Marca />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {menuPrincipal.map((entrada) =>
          esGrupoNav(entrada) ? (
            <div
              key={entrada.id}
              role="group"
              aria-labelledby={`nav-grupo-${entrada.id}`}
              className="flex flex-col gap-1 pt-2"
            >
              <span
                id={`nav-grupo-${entrada.id}`}
                className="flex items-center gap-1.5 px-2.5 pb-0.5 text-2xs font-medium uppercase tracking-wide text-fg-muted"
              >
                <entrada.icono size={12} strokeWidth={2} aria-hidden />
                {entrada.etiqueta}
              </span>
              {entrada.destinos.map((destino) => (
                <DestinoLink
                  key={destino.id}
                  destino={destino}
                  activo={destino.href === rutaActiva}
                  pendientes={pendientes}
                  estadoCanales={estadoCanales}
                  linkComponent={linkComponent}
                />
              ))}
              <span aria-hidden className="h-1" />
            </div>
          ) : (
            <DestinoLink
              key={entrada.id}
              destino={entrada}
              activo={entrada.href === rutaActiva}
              pendientes={pendientes}
              estadoCanales={estadoCanales}
              linkComponent={linkComponent}
            />
          ),
        )}

        <hr className="my-2 border-0 border-t border-[var(--border-subtle)]" />

        <DestinoLink
          destino={destinoContratar}
          activo={destinoContratar.href === rutaActiva}
          linkComponent={linkComponent}
        />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border-subtle)] p-2">
        <CreditsWidget {...creditos} />

        <DestinoLink
          destino={destinoAjustes}
          activo={destinoAjustes.href === rutaActiva}
          linkComponent={linkComponent}
        />

        <button
          type="button"
          onClick={onUsuarioClick}
          className={cn(
            "flex h-11 items-center gap-2.5 rounded-md px-2 text-left transition-colors",
            "duration-[var(--dur-instant)] hover:bg-hover",
            focusRing,
          )}
        >
          <Avatar name={usuario.nombre} src={usuario.avatar} size="md" tone="humano" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-fg">{usuario.nombre}</span>
            <span className="truncate text-2xs text-fg-muted">{usuario.correo}</span>
          </span>
        </button>
      </div>
    </nav>
  );
}

export interface SidebarRailProps extends React.HTMLAttributes<HTMLElement> {
  rutaActiva: Ruta;
  pendientes?: number;
  estadoCanales?: EstadoCanal;
  usuario: UsuarioSidebar;
  creditos: Omit<CreditsWidgetProps, "colapsado">;
  linkComponent?: React.ElementType;
}

/** Versión de 64px: los mismos destinos, solo iconos, con el nombre en tooltip. */
export function SidebarRail({
  rutaActiva,
  pendientes,
  estadoCanales,
  usuario,
  creditos,
  linkComponent = "a",
  className,
  ...props
}: SidebarRailProps) {
  const Link = linkComponent;
  const destinos = [...destinosPrincipales, destinoContratar, destinoAjustes];

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "flex h-full w-16 shrink-0 flex-col items-center border-r border-border bg-nav",
        className,
      )}
      {...props}
    >
      <div className="flex h-[52px] shrink-0 items-center justify-center">
        <Marca soloIcono />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
        {destinos.map((destino) => {
          const activo = destino.href === rutaActiva;
          const Icono = destino.icono;
          return (
            <Tooltip key={destino.id} content={destino.etiqueta} side="right">
              <Link
                href={destino.href}
                aria-label={destino.etiqueta}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "relative grid size-9 place-items-center rounded-md transition-colors",
                  "duration-[var(--dur-instant)]",
                  activo ? "bg-selected text-primary-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
                  focusRing,
                )}
              >
                <Icono size={18} strokeWidth={1.75} aria-hidden />
                {destino.indicador === "contador" && pendientes ? (
                  <span className="tnum absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-[var(--fg-on-brand)]">
                    {pendientes > 9 ? "9+" : pendientes}
                  </span>
                ) : null}
                {destino.indicador === "estado" && estadoCanales ? (
                  <span
                    className={cn(
                      "absolute right-1 top-1 size-1.5 rounded-full",
                      puntoEstado[estadoCanales],
                    )}
                  />
                ) : null}
              </Link>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-[var(--border-subtle)] py-2">
        <CreditsWidget {...creditos} colapsado className="w-full" />
        <Avatar name={usuario.nombre} src={usuario.avatar} size="md" tone="humano" />
      </div>
    </nav>
  );
}

function Marca({ soloIcono }: { soloIcono?: boolean }) {
  return (
    <span className="flex items-center gap-2 px-1">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-[var(--fg-on-brand)]">
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" aria-hidden>
          <path
            d="M7 17V10a5 5 0 0 1 10 0v3"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {!soloIcono && (
        <span className="text-lg font-semibold tracking-tight text-fg">Strappy</span>
      )}
    </span>
  );
}
