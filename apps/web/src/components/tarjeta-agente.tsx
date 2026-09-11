"use client";

/**
 * Las tarjetas de la pantalla de Agentes.
 *
 * Cada agente del catálogo tiene su personaje y un estado que se lee en texto,
 * no solo en un punto de color: «Activo», «Borrador», «En pausa». Toda la
 * tarjeta abre el agente; el menú guarda lo secundario.
 *
 * Los personajes vienen con fondo transparente y de cuerpo entero: se muestran
 * enteros sobre un halo, sin recortarlos en círculo, que les cortaría la gorra
 * y las manos.
 */
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, EllipsisVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, cn } from "@strappy/ui";
import { AVATAR_POR_DEFECTO } from "@/lib/avatares";

type Papel = { nombre: string; imagen?: string; halo: string };

const PAPELES: Record<string, Papel> = {
  webmaster: {
    nombre: "Webmaster",
    imagen: "/agentes/webmaster-plastilina.webp",
    halo: "radial-gradient(circle, rgba(45,212,191,0.30) 0%, rgba(45,212,191,0) 70%)",
  },
  marketing: {
    nombre: "Marketing",
    imagen: "/agentes/marketing-plastilina.webp",
    halo: "radial-gradient(circle, rgba(251,113,133,0.30) 0%, rgba(251,113,133,0) 70%)",
  },
};

/**
 * Los agentes de WhatsApp los crea la persona y cada uno tiene su foto de
 * plastilina (`agents.avatar_url`). Sin foto todavía, la primera de la serie.
 */
const PROPIO: Papel = {
  nombre: "Agente de WhatsApp",
  imagen: AVATAR_POR_DEFECTO,
  halo: "radial-gradient(circle, rgba(57,255,20,0.22) 0%, rgba(57,255,20,0) 70%)",
};

/** Hover común: se eleva un poco y el borde se tiñe de marca. Sin mover el layout. */
const TARJETA =
  "group relative flex aspect-[4/5] cursor-pointer flex-col rounded-xl border p-4 transition-[transform,border-color,background-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] hover:-translate-y-0.5 hover:shadow-e2 motion-reduce:hover:translate-y-0";

export type DatosTarjetaAgente = {
  id: string;
  nombre: string;
  catalogo: string | null;
  estado: string;
  modo: "lite" | "max";
  activo: boolean;
  /** Foto del agente de WhatsApp; los del catálogo usan su personaje. */
  avatar?: string | null;
};

export function TarjetaAgente({ agente, destino }: { agente: DatosTarjetaAgente; destino: string }) {
  const router = useRouter();
  const papel = (agente.catalogo ? PAPELES[agente.catalogo] : undefined) ?? {
    ...PROPIO,
    imagen: agente.avatar || AVATAR_POR_DEFECTO,
  };
  const estado = agente.activo ? "Activo" : agente.estado === "paused" ? "En pausa" : "Borrador";

  return (
    <div
      className={cn(
        TARJETA,
        "border-border bg-raised hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:bg-hover",
      )}
    >
      {/* El enlace cubre la tarjeta; el menú va por encima para no anidar elementos interactivos. */}
      <Link
        href={destino}
        aria-label={`Abrir ${agente.nombre}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
      />

      <span
        className={cn(
          "pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium",
          agente.activo ? "bg-success-soft text-success-fg" : "bg-hover text-fg-muted",
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", agente.activo ? "animate-pulse bg-success" : "bg-fg-muted")}
        />
        {estado}
      </span>

      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Opciones de ${agente.nombre}`}
              className="grid size-8 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-active hover:text-fg"
            >
              <EllipsisVertical size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(destino)}>Abrir</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/agentes/${agente.id}/probar`)}>Probar</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/agentes/${agente.id}/instrucciones`)}>
              Instrucciones
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pointer-events-none flex flex-1 items-center justify-center">
        <Retrato papel={papel} />
      </div>

      <div className="pointer-events-none flex min-w-0 items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-fg">{agente.nombre}</p>
          <p className="truncate text-2xs text-fg-muted">
            {papel.nombre} · {agente.modo === "max" ? "Max" : "Lite"}
          </p>
        </div>
        <ArrowRight
          size={16}
          strokeWidth={2}
          aria-hidden
          className="shrink-0 -translate-x-1 text-primary-fg opacity-0 transition duration-[var(--dur-base)] group-hover:translate-x-0 group-hover:opacity-100"
        />
      </div>
    </div>
  );
}

function Retrato({ papel, apagado = false }: { papel: Papel; apagado?: boolean }) {
  return (
    <span className="relative grid size-32 place-items-center">
      {!apagado && <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: papel.halo }} />}
      {papel.imagen ? (
        <Image
          src={papel.imagen}
          alt=""
          width={160}
          height={160}
          sizes="160px"
          className={cn(
            "relative size-36 object-contain transition duration-[var(--dur-base)] motion-reduce:transition-none",
            apagado
              ? "opacity-50 grayscale group-hover:opacity-100 group-hover:grayscale-0"
              : "drop-shadow-[0_8px_16px_rgba(0,0,0,0.45)] group-hover:-translate-y-1",
          )}
        />
      ) : (
        <span
          className={cn(
            "relative grid size-20 place-items-center rounded-full",
            apagado
              ? "bg-hover text-fg-muted"
              : "bg-[linear-gradient(135deg,#39ff14_0%,#0080ff_100%)] text-black shadow-lg ring-1 ring-white/10",
          )}
        >
          <Bot size={34} strokeWidth={1.75} aria-hidden />
        </span>
      )}
    </span>
  );
}

export type DatosTarjetaCatalogo = {
  slug: string;
  nombre: string;
  tagline: string | null;
  costeUsd: number;
};

const usd = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Un agente del catálogo que el espacio todavía no tiene. En gris: se ve qué
 * se puede contratar sin confundirlo con lo que ya trabaja. Al pasar por
 * encima recupera el color, y toda la tarjeta lleva a contratarlo.
 */
export function TarjetaCatalogo({ ficha }: { ficha: DatosTarjetaCatalogo }) {
  const papel = PAPELES[ficha.slug] ?? PROPIO;

  return (
    <Link
      href={`/contratar/${ficha.slug}`}
      className={cn(
        TARJETA,
        "border-dashed border-border hover:border-solid hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
      )}
    >
      <span className="absolute left-3 top-3 rounded-full bg-hover px-2 py-0.5 text-2xs text-fg-muted">
        Sin contratar
      </span>

      <div className="flex flex-1 items-center justify-center">
        <Retrato papel={papel} apagado />
      </div>

      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-fg-secondary transition-colors group-hover:text-fg">
          {ficha.nombre}
        </p>
        <p className="truncate text-2xs text-fg-muted">{ficha.tagline ?? papel.nombre}</p>
        <p className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-primary-fg">
          Contratar{ficha.costeUsd > 0 ? ` · ${usd.format(ficha.costeUsd)}/mes` : ""}
          <ArrowRight
            size={12}
            strokeWidth={2.5}
            aria-hidden
            className="transition-transform duration-[var(--dur-base)] group-hover:translate-x-0.5"
          />
        </p>
      </div>
    </Link>
  );
}
