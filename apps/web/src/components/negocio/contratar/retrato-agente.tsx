/**
 * El personaje de un agente sobre su halo.
 *
 * Los personajes vienen de cuerpo entero y con fondo transparente: se enseñan
 * enteros, sin recortarlos en círculo, que les cortaría la gorra y las manos.
 *
 * La imagen llega como dato (`catalog_agents.avatar_url`, o la que el cliente
 * le puso a su agente). Sin imagen se pinta el robot: es honesto, significa que
 * a ese agente todavía no le han puesto cara.
 */
import Image from "next/image";
import { cn } from "@strappy/ui";
import { IconoSinPersonaje, personajeDe } from "./personajes";

export function RetratoAgente({
  slug,
  imagen,
  tamano,
  apagado = false,
  className,
}: {
  slug: string;
  /** La cara que trae el dato. Sin ella, el robot. */
  imagen?: string | null;
  /** Lado en píxeles de la caja del personaje. */
  tamano: number;
  /** En gris, para lo que todavía no está disponible. */
  apagado?: boolean;
  className?: string;
}) {
  const personaje = personajeDe(slug, imagen);
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: tamano, height: tamano }}
    >
      <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: personaje.halo }} />
      {personaje.imagen ? (
        <Image
          src={personaje.imagen}
          alt=""
          width={tamano}
          height={tamano}
          sizes={`${tamano}px`}
          className={cn(
            "relative size-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)] transition-transform duration-[var(--dur-base)] group-hover:-translate-y-1 motion-reduce:transition-none",
            apagado && "opacity-60 grayscale",
          )}
        />
      ) : (
        <span className="relative grid size-1/2 place-items-center rounded-full bg-[linear-gradient(135deg,#39ff14_0%,#0080ff_100%)] text-black shadow-lg">
          <IconoSinPersonaje size={Math.round(tamano / 4)} strokeWidth={1.75} aria-hidden />
        </span>
      )}
    </span>
  );
}
