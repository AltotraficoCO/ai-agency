"use client";

/**
 * Las tarjetas de la pantalla de Agentes.
 *
 * Cada agente tiene una cara reconocible —un avatar por su papel— y un punto
 * que dice la verdad: verde si atiende o trabaja ahora mismo, gris si todavía
 * no hace nada. Toda la tarjeta abre el agente; el menú guarda lo secundario.
 * La de contratar va siempre primera: añadir un agente es la acción de esta
 * pantalla, no un botón escondido en la barra.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  EllipsisVertical,
  Globe,
  Megaphone,
  MessageCircle,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@strappy/ui";

type Papel = { nombre: string; icono: LucideIcon; fondo: string };

const PAPELES: Record<string, Papel> = {
  webmaster: {
    nombre: "Webmaster",
    icono: Globe,
    fondo: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)",
  },
  recepcionista: {
    nombre: "Recepcionista",
    icono: MessageCircle,
    fondo: "linear-gradient(135deg, #34d399 0%, #0d9488 100%)",
  },
  marketing: {
    nombre: "Marketing",
    icono: Megaphone,
    fondo: "linear-gradient(135deg, #fbbf24 0%, #f43f5e 100%)",
  },
};

const PROPIO: Papel = {
  nombre: "Agente propio",
  icono: Bot,
  fondo: "linear-gradient(135deg, #a78bfa 0%, #d946ef 100%)",
};

export type DatosTarjetaAgente = {
  id: string;
  nombre: string;
  catalogo: string | null;
  estado: string;
  modo: "lite" | "max";
  activo: boolean;
};

export function TarjetaAgente({ agente, destino }: { agente: DatosTarjetaAgente; destino: string }) {
  const router = useRouter();
  const papel = (agente.catalogo ? PAPELES[agente.catalogo] : undefined) ?? PROPIO;
  const Icono = papel.icono;
  const estado = agente.activo ? "Activo" : agente.estado === "paused" ? "En pausa" : "Borrador";

  return (
    <div className="group relative flex aspect-[4/5] flex-col rounded-xl border border-[var(--border-subtle)] bg-inset p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-hover">
      {/* El enlace cubre la tarjeta; el menú va por encima para no anidar elementos interactivos. */}
      <Link
        href={destino}
        aria-label={`Abrir ${agente.nombre}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-strong)]"
      />

      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Opciones de ${agente.nombre}`}
              className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-active hover:text-fg"
            >
              <EllipsisVertical size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(destino)}>Abrir</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/agentes/${agente.id}/instrucciones`)}>
              Instrucciones
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pointer-events-none flex flex-1 items-center justify-center">
        <span className="relative">
          <span
            className="grid size-20 place-items-center rounded-full text-white shadow-lg ring-1 ring-white/10"
            style={{ background: papel.fondo }}
          >
            <Icono size={34} strokeWidth={1.75} aria-hidden />
          </span>
          <span
            title={estado}
            className={`absolute bottom-0.5 right-0.5 size-4 rounded-full border-[3px] border-black/40 ${
              agente.activo ? "bg-success" : "bg-[var(--border-strong)]"
            }`}
          >
            <span className="sr-only">{estado}</span>
          </span>
        </span>
      </div>

      <div className="pointer-events-none min-w-0">
        <p className="truncate text-base font-semibold text-fg">{agente.nombre}</p>
        <p className="truncate text-2xs text-fg-muted">
          {papel.nombre} · {agente.modo === "max" ? "Max" : "Lite"}
          {agente.activo ? "" : ` · ${estado}`}
        </p>
      </div>
    </div>
  );
}

export function TarjetaContratar() {
  return (
    <Link
      href="/contratar"
      className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] text-fg-muted transition-colors hover:bg-hover hover:text-fg"
    >
      <Plus size={28} strokeWidth={1.5} aria-hidden />
      <span className="text-sm">Contratar agente</span>
    </Link>
  );
}
