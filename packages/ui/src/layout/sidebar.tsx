"use client";

import * as React from "react";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { Avatar } from "../components/avatar";
import { IconButton } from "../components/icon-button";
import { Tooltip } from "../components/tooltip";
import { BotonTema } from "./boton-tema";
import { CreditsWidget, type CreditsWidgetProps } from "./credits-widget";
import { useGruposMenu } from "./grupos-menu";
import {
  destinoAjustes,
  destinoContratar,
  entradaDeGrupo,
  esGrupoNav,
  etiquetaEstadoCanal,
  menuPrincipal,
  type DestinoNav,
  type EstadoCanal,
  type GrupoNav,
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
  /** Solo iconos, 64 px. Lo decide la persona con el botón de plegar. */
  colapsado?: boolean;
  /** Sin esto no se enseña el botón de plegar (p. ej. dentro del menú móvil). */
  onAlternarColapso?: () => void;
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
  className?: string;
}

function DestinoLink({ destino, activo, pendientes, estadoCanales, linkComponent, className }: DestinoLinkProps) {
  const Link = linkComponent;
  const Icono = destino.icono;

  return (
    <Link
      href={destino.href}
      aria-current={activo ? "page" : undefined}
      className={cn(
        "group relative flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-3 text-base font-semibold",
        "transition-[color,background-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]",
        "active:scale-x-[1.02] active:scale-y-[0.94] motion-reduce:active:scale-100",
        // Activo: una bolita de plastilina morada, con volumen, bajo el destino.
        activo
          ? "bg-selected text-primary-fg shadow-e1"
          : "text-fg-secondary hover:translate-x-0.5 hover:bg-hover hover:text-fg",
        destino.destacado &&
          !activo &&
          "bg-primary text-[var(--fg-on-brand)] shadow-marca [background-image:linear-gradient(180deg,rgb(255_255_255/0.18),transparent_65%)] hover:translate-x-0 hover:-translate-y-0.5 hover:bg-[var(--brand-hover)] hover:text-[var(--fg-on-brand)]",
        focusRing,
        className,
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

/** El mismo destino, solo con icono y el nombre en un tooltip. */
function DestinoIcono({ destino, activo, pendientes, estadoCanales, linkComponent }: DestinoLinkProps) {
  const Link = linkComponent;
  const Icono = destino.icono;
  return (
    <Tooltip content={destino.etiqueta} side="right">
      <Link
        href={destino.href}
        aria-label={destino.etiqueta}
        aria-current={activo ? "page" : undefined}
        className={cn(
          "relative grid size-10 cursor-pointer place-items-center rounded-md transition-colors duration-[var(--dur-fast)]",
          activo ? "bg-selected text-primary-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
          activo &&
            "before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary",
          destino.destacado && !activo && "bg-primary-soft text-primary-fg hover:bg-primary hover:text-[var(--fg-on-brand)]",
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
          <span className={cn("absolute right-1 top-1 size-1.5 rounded-full", puntoEstado[estadoCanales])} />
        ) : null}
      </Link>
    </Tooltip>
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
  colapsado = false,
  onAlternarColapso,
  className,
  ...props
}: SidebarProps) {
  const [elecciones, elegirGrupo] = useGruposMenu();

  if (colapsado) {
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

        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
          {onAlternarColapso ? (
            <Tooltip content="Desplegar el menú" side="right">
              <IconButton label="Desplegar el menú" onClick={onAlternarColapso} className="mb-1 size-10 cursor-pointer">
                <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
          ) : null}

          {menuPrincipal.map((entrada) => {
            if (!esGrupoNav(entrada)) {
              return (
                <DestinoIcono
                  key={entrada.id}
                  destino={entrada}
                  activo={entrada.href === rutaActiva}
                  pendientes={pendientes}
                  estadoCanales={estadoCanales}
                  linkComponent={linkComponent}
                />
              );
            }

            // Plegado no hay títulos, así que un departamento de una sola
            // pantalla es un icono más, con el nombre del departamento en su
            // tooltip: es lo que la persona busca.
            const directo = entradaDeGrupo(entrada);
            if (directo) {
              return (
                <DestinoIcono
                  key={entrada.id}
                  destino={directo}
                  activo={directo.href === rutaActiva}
                  pendientes={pendientes}
                  estadoCanales={estadoCanales}
                  linkComponent={linkComponent}
                />
              );
            }

            return (
              <div key={entrada.id} role="group" aria-label={entrada.etiqueta} className="flex flex-col items-center gap-1">
                <span aria-hidden className="my-1.5 h-px w-7 bg-[var(--border-subtle)]" />
                {entrada.destinos.map((destino) => (
                  <DestinoIcono
                    key={destino.id}
                    destino={destino}
                    activo={destino.href === rutaActiva}
                    pendientes={pendientes}
                    estadoCanales={estadoCanales}
                    linkComponent={linkComponent}
                  />
                ))}
              </div>
            );
          })}

          <span aria-hidden className="my-1.5 h-px w-7 bg-[var(--border-subtle)]" />
          <DestinoIcono
            destino={destinoContratar}
            activo={destinoContratar.href === rutaActiva}
            linkComponent={linkComponent}
          />
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-[var(--border-subtle)] py-2">
          <CreditsWidget {...creditos} colapsado className="w-full" />
          <DestinoIcono
            destino={destinoAjustes}
            activo={destinoAjustes.href === rutaActiva}
            linkComponent={linkComponent}
          />
          <BotonTema className="size-10 cursor-pointer" />
          <button
            type="button"
            onClick={onUsuarioClick}
            aria-label={`Tu cuenta: ${usuario.nombre}`}
            className={cn("cursor-pointer rounded-full", focusRing)}
          >
            <Avatar name={usuario.nombre} src={usuario.avatar} size="md" tone="humano" />
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-nav",
        className,
      )}
      {...props}
    >
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 pl-3 pr-2">
        <Marca />
        {onAlternarColapso ? (
          <Tooltip content="Plegar el menú" side="right">
            <IconButton label="Plegar el menú" size="sm" onClick={onAlternarColapso} className="cursor-pointer">
              <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {menuPrincipal.map((entrada) => {
          if (!esGrupoNav(entrada)) {
            return (
              <DestinoLink
                key={entrada.id}
                destino={entrada}
                activo={entrada.href === rutaActiva}
                pendientes={pendientes}
                estadoCanales={estadoCanales}
                linkComponent={linkComponent}
              />
            );
          }

          // Un departamento con una sola pantalla no se esconde tras un
          // desplegable: serían dos clics para llegar a lo mismo.
          const directo = entradaDeGrupo(entrada);
          if (directo) {
            return (
              <DestinoLink
                key={entrada.id}
                destino={directo}
                activo={directo.href === rutaActiva}
                pendientes={pendientes}
                estadoCanales={estadoCanales}
                linkComponent={linkComponent}
              />
            );
          }

          return (
            <GrupoPlegable
              key={entrada.id}
              grupo={entrada}
              rutaActiva={rutaActiva}
              abierto={
                elecciones[entrada.id] ?? entrada.destinos.some((d) => d.href === rutaActiva)
              }
              onAlternar={(abierto) => elegirGrupo(entrada.id, abierto)}
              pendientes={pendientes}
              estadoCanales={estadoCanales}
              linkComponent={linkComponent}
            />
          );
        })}

        <hr className="my-3 border-0 border-t border-[var(--border-subtle)]" />

        <DestinoLink
          destino={destinoContratar}
          activo={destinoContratar.href === rutaActiva}
          linkComponent={linkComponent}
        />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border-subtle)] p-2">
        <CreditsWidget {...creditos} />

        <div className="flex items-center gap-1">
          <DestinoLink
            destino={destinoAjustes}
            activo={destinoAjustes.href === rutaActiva}
            linkComponent={linkComponent}
            className="flex-1"
          />
          <BotonTema className="cursor-pointer" />
        </div>

        <button
          type="button"
          onClick={onUsuarioClick}
          className={cn(
            "flex h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 text-left transition-colors",
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

/**
 * Un módulo del menú (WhatsApp, Negocio) que se abre y se cierra.
 *
 * Cerrado, el título sigue diciendo lo importante: si estás dentro (punto
 * verde) y cuántas conversaciones esperan en la Bandeja. Así recoger el menú
 * no esconde nada urgente.
 */
function GrupoPlegable({
  grupo,
  rutaActiva,
  abierto,
  onAlternar,
  pendientes,
  estadoCanales,
  linkComponent,
}: {
  grupo: GrupoNav;
  rutaActiva: Ruta;
  abierto: boolean;
  onAlternar: (abierto: boolean) => void;
  pendientes?: number;
  estadoCanales?: EstadoCanal;
  linkComponent: React.ElementType;
}) {
  const idContenido = `nav-grupo-${grupo.id}`;
  const contieneActiva = grupo.destinos.some((d) => d.href === rutaActiva);
  const tieneContador = grupo.destinos.some((d) => d.indicador === "contador");
  const Icono = grupo.icono;

  return (
    <div className="flex flex-col pt-1">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idContenido}
        onClick={() => onAlternar(!abierto)}
        className={cn(
          "group flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-base font-medium",
          "transition-colors duration-[var(--dur-fast)] hover:bg-hover",
          contieneActiva && !abierto ? "text-fg" : "text-fg-secondary hover:text-fg",
          focusRing,
        )}
      >
        <Icono
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className={cn("shrink-0", contieneActiva && "text-primary-fg")}
        />
        <span className="truncate">{grupo.etiqueta}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {!abierto && tieneContador && pendientes ? (
            <span className="tnum rounded-full bg-primary px-1.5 py-px text-2xs font-semibold text-[var(--fg-on-brand)]">
              {pendientes > 99 ? "99+" : pendientes}
              <span className="sr-only"> conversaciones sin atender</span>
            </span>
          ) : null}
          {!abierto && contieneActiva ? (
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          ) : null}
          <ChevronRight
            size={15}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "text-fg-muted transition-transform duration-[var(--dur-base)] ease-[var(--ease-out-quart)] motion-reduce:transition-none",
              abierto && "rotate-90",
            )}
          />
        </span>
      </button>

      {/* grid-rows 0fr → 1fr anima la altura sin medirla en JavaScript. */}
      <div
        id={idContenido}
        className={cn(
          "grid transition-[grid-template-rows] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] motion-reduce:transition-none",
          abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden" {...(abierto ? {} : { inert: true })}>
          <div
            role="group"
            aria-label={grupo.etiqueta}
            className="ml-[18px] flex flex-col gap-0.5 border-l border-[var(--border-subtle)] py-1 pl-2"
          >
            {grupo.destinos.map((destino) => (
              <DestinoLink
                key={destino.id}
                destino={destino}
                activo={destino.href === rutaActiva}
                pendientes={pendientes}
                estadoCanales={estadoCanales}
                linkComponent={linkComponent}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export type SidebarRailProps = Omit<SidebarProps, "colapsado">;

/** Versión de 64 px: la misma navegación plegada. */
export function SidebarRail(props: SidebarRailProps) {
  return <Sidebar {...props} colapsado />;
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
