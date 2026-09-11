"use client";

/**
 * Las tarjetas de la pantalla de Agentes.
 *
 * Cada agente del catálogo tiene su personaje, y un punto que dice la verdad:
 * verde si atiende o trabaja ahora mismo, gris si todavía no hace nada. Toda la
 * tarjeta abre el agente; el menú guarda lo secundario. La de contratar va
 * siempre primera: añadir un agente es la acción de esta pantalla, no un botón
 * escondido en la barra.
 *
 * Los personajes vienen con fondo transparente y de cuerpo entero: se muestran
 * enteros sobre un halo, sin recortarlos en círculo, que les cortaría la gorra
 * y las manos.
 */
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, EllipsisVertical, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@strappy/ui";

type Papel = { nombre: string; imagen?: string; halo: string };

const PAPELES: Record<string, Papel> = {
  webmaster: {
    nombre: "Webmaster",
    imagen: "/agentes/webmaster.webp",
    halo: "radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(59,130,246,0) 70%)",
  },
  recepcionista: {
    nombre: "Recepcionista",
    imagen: "/agentes/recepcionista.webp",
    halo: "radial-gradient(circle, rgba(56,189,248,0.32) 0%, rgba(56,189,248,0) 70%)",
  },
  marketing: {
    nombre: "Marketing",
    imagen: "/agentes/marketing.webp",
    halo: "radial-gradient(circle, rgba(99,102,241,0.35) 0%, rgba(99,102,241,0) 70%)",
  },
};

/** Los agentes propios no tienen personaje todavía: un robot sobre un degradado. */
const PROPIO: Papel = {
  nombre: "Agente propio",
  halo: "radial-gradient(circle, rgba(167,139,250,0.3) 0%, rgba(167,139,250,0) 70%)",
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
        <span className="relative grid size-32 place-items-center">
          <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: papel.halo }} />
          {papel.imagen ? (
            <Image
              src={papel.imagen}
              alt=""
              width={160}
              height={160}
              sizes="160px"
              className="relative size-36 object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.45)] transition-transform duration-[var(--dur-base)] group-hover:-translate-y-1 motion-reduce:transition-none"
            />
          ) : (
            <span className="relative grid size-20 place-items-center rounded-full bg-[linear-gradient(135deg,#a78bfa_0%,#d946ef_100%)] text-white shadow-lg ring-1 ring-white/10">
              <Bot size={34} strokeWidth={1.75} aria-hidden />
            </span>
          )}
          <span
            title={estado}
            className={`absolute bottom-2 right-2 size-4 rounded-full border-[3px] border-black/40 ${
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
