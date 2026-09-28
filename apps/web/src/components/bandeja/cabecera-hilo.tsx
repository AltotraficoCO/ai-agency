"use client";

/**
 * La cabecera del hilo: quién es la persona, y posponer, cerrar o abrir su ficha.
 */
import { ArrowLeft, CheckCircle2, Clock, PanelRight } from "lucide-react";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@strappy/ui";
import type { Hilo as HiloDatos } from "@/lib/bandeja/tipos";
import { instanteRelativo, mananaALas } from "./formato";

export function CabeceraHilo({
  hilo,
  alVolver,
  alAbrirFicha,
  alPosponer,
  alCerrar,
}: {
  hilo: HiloDatos;
  alVolver: () => void;
  alAbrirFicha: () => void;
  alPosponer: (hasta: string | null) => void;
  alCerrar: () => void;
}) {
  const cerrada = hilo.conversacion.estado === "closed";
  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
      <IconButton label="Volver a la lista" size="sm" className="lg:hidden" onClick={alVolver}>
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
      {/* Pulsar en la persona abre su ficha: es lo que se busca al mirar su nombre. */}
      <button
        type="button"
        onClick={alAbrirFicha}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-hover min-[1440px]:pointer-events-none"
      >
        <Avatar size="md" tone="cliente" name={hilo.contacto.nombre} />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-fg">{hilo.contacto.nombre}</span>
          <span className="block truncate text-xs text-fg-muted">
            {hilo.contacto.telefono ? `${hilo.contacto.telefono} · ` : ""}
            {hilo.conversacion.canal.nombre}
            {hilo.conversacion.estado === "snoozed" && hilo.conversacion.pospuestaHasta && " · pospuesta"}
            {cerrada && " · cerrada"}
          </span>
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Clock size={15} strokeWidth={1.75} aria-hidden />
            Posponer
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => alPosponer(instanteRelativo(1))}>1 hora</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => alPosponer(instanteRelativo(3))}>3 horas</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => alPosponer(mananaALas())}>Mañana a las 9:00</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => alPosponer(null)}>Devolver a la bandeja</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="sm" onClick={alCerrar}>
        <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden />
        {cerrada ? "Reabrir" : "Cerrar"}
      </Button>

      <IconButton
        label="Ver la ficha del contacto"
        size="sm"
        className="min-[1440px]:hidden"
        onClick={alAbrirFicha}
      >
        <PanelRight size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
    </header>
  );
}
