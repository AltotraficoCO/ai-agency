"use client";

/**
 * La pantalla de inicio.
 *
 * No es un panel de control: es un chat. No hay tarjetas de métricas ni un
 * estado vacío que te felicite por no tener nada. Hay una pregunta —«¿qué
 * construimos hoy?»—, sitio para contestarla y cuatro atajos para quien no sabe
 * por dónde empezar.
 *
 * Los atajos son tarjetas y no chips: una línea de descripción basta para que
 * alguien que no conoce el producto sepa qué pasa al pulsar, y eso vale más que
 * el espacio que ocupan.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronRight,
  MessageCircle,
  MessagesSquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge, cn, toast } from "@strappy/ui";
import {
  CHIPS_INTENCION,
  type ChipIntencion,
  type ModoConstruccion,
  type ResumenHilo,
} from "@/lib/meta/tipos";
import { Composer } from "./composer";
import { Orbe } from "./orbe";

const ICONOS: Readonly<Record<ChipIntencion["icono"], LucideIcon>> = {
  bot: Bot,
  whatsapp: MessageCircle,
  catalogo: BookOpen,
  "catalogo-agentes": Sparkles,
};

export interface InicioProps {
  nombre: string;
  hilos: readonly ResumenHilo[];
  maxDisponible: boolean;
}

export function Inicio({ nombre, hilos, maxDisponible }: InicioProps) {
  const router = useRouter();
  const [texto, setTexto] = React.useState("");
  const [modo, setModo] = React.useState<ModoConstruccion>("lite");
  const [abriendo, setAbriendo] = React.useState(false);

  const arrancar = async (mensaje: string): Promise<void> => {
    const limpio = mensaje.trim();
    if (limpio.length === 0 || abriendo) return;
    setAbriendo(true);
    try {
      // El hilo se crea ANTES del primer mensaje: así el borrador existe desde
      // el segundo cero y cerrar la pestaña a mitad no pierde nada.
      const respuesta = await fetch("/api/meta/hilos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ titulo: limpio.slice(0, 60) }),
      });
      if (!respuesta.ok) throw new Error("No se pudo abrir la conversación.");
      const { id } = (await respuesta.json()) as { id: string };
      router.push(`/c/${id}?abrir=${encodeURIComponent(limpio)}&modo=${modo}`);
    } catch (error) {
      setAbriendo(false);
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la conversación.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-10 px-5 py-12 sm:py-16">
      <div className="strappy-slide-up flex flex-col items-center gap-5 text-center">
        {/* Strap en su foto de perfil: redonda y grande, el anfitrión de la pantalla. */}
        <Orbe size={104} pose="saludando" />
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-balance text-4xl font-semibold tracking-tightest text-fg">
            Hola {nombre}, ¿qué construimos hoy?
          </h1>
          <p className="max-w-[560px] text-balance text-md text-fg-secondary">
            Cuéntame de tu negocio y te armo un agente que atiende a tus clientes por WhatsApp: sabe
            lo que vendes, toma sus datos y le pasa la conversación a tu equipo cuando hace falta.
          </p>
        </div>
      </div>

      <div className="strappy-slide-up w-full [animation-delay:60ms]">
        <Composer
          autoFocus
          valor={texto}
          onCambio={setTexto}
          onEnviar={() => void arrancar(texto)}
          modo={modo}
          onModo={setModo}
          maxDisponible={maxDisponible}
          onAmpliarPlan={() => router.push("/ajustes/facturacion")}
          ocupado={abriendo}
          placeholder="Quiero un agente que atienda pedidos por WhatsApp…"
        />
        <p className="pt-2 text-center text-sm text-fg-muted">
          Enter para enviar · Shift + Enter para saltar de línea
        </p>
      </div>

      <section aria-labelledby="inicio-atajos" className="strappy-slide-up [animation-delay:120ms]">
        <h2 id="inicio-atajos" className="pb-3 text-2xs font-medium uppercase tracking-wide text-fg-muted">
          O empieza por aquí
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHIPS_INTENCION.map((chip) => (
            <TarjetaAtajo
              key={chip.id}
              chip={chip}
              deshabilitada={abriendo}
              onElegir={() => (chip.href ? router.push(chip.href) : void arrancar(chip.mensaje))}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="inicio-recientes" className="strappy-slide-up [animation-delay:180ms]">
        <h2
          id="inicio-recientes"
          className="pb-3 text-2xs font-medium uppercase tracking-wide text-fg-muted"
        >
          Conversaciones recientes
        </h2>
        {hilos.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {hilos.map((hilo) => (
              <li key={hilo.id}>
                <FilaHilo hilo={hilo} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-inset text-fg-muted">
              <MessagesSquare size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex flex-col">
              <p className="text-base font-medium text-fg">Aún no has hablado con Strap</p>
              <p className="text-sm text-fg-muted">
                Tus conversaciones aparecerán aquí para retomarlas donde las dejaste.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TarjetaAtajo({
  chip,
  deshabilitada,
  onElegir,
}: {
  chip: ChipIntencion;
  deshabilitada: boolean;
  onElegir: () => void;
}) {
  const Icono = ICONOS[chip.icono] ?? Sparkles;
  const Flecha = chip.href ? ArrowUpRight : ChevronRight;
  return (
    <button
      type="button"
      disabled={deshabilitada}
      onClick={onElegir}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border bg-raised p-4 text-left",
        "transition-[transform,border-color,background-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out-quart)]",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:bg-hover hover:shadow-e2",
        "active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 motion-reduce:hover:translate-y-0",
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg transition-colors group-hover:bg-primary group-hover:text-on-primary">
        <Icono size={18} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg">{chip.etiqueta}</span>
        <span className="text-sm text-fg-secondary">{chip.descripcion}</span>
      </span>
      <Flecha
        size={16}
        strokeWidth={2}
        aria-hidden
        className="mt-0.5 shrink-0 text-fg-muted transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary-fg"
      />
    </button>
  );
}

function FilaHilo({ hilo }: { hilo: ResumenHilo }) {
  const cuando = fechaRelativa(hilo.actualizado);
  return (
    <Link
      href={`/c/${hilo.id}`}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-raised px-4 py-3 transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:bg-hover"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          hilo.publicado ? "bg-primary-soft text-primary-fg" : "bg-inset text-fg-muted",
        )}
      >
        <Bot size={17} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-medium text-fg">{hilo.titulo}</span>
        {cuando ? (
          <span className="text-sm text-fg-muted" suppressHydrationWarning>
            {cuando}
          </span>
        ) : null}
      </span>
      <Badge tone={hilo.publicado ? "exito" : "neutral"}>
        {hilo.publicado ? "Publicado" : hilo.etiquetaFase}
      </Badge>
      <ChevronRight
        size={16}
        strokeWidth={2}
        aria-hidden
        className="shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

const RELATIVA = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

/** «hace 3 días», «ayer», «hace 5 minutos». Vacío si la fecha no se entiende. */
function fechaRelativa(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const segundos = Math.round((fecha.getTime() - Date.now()) / 1000);
  const tramos: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unidad, tamano] of tramos) {
    if (Math.abs(segundos) >= tamano) return RELATIVA.format(Math.round(segundos / tamano), unidad);
  }
  return "hace un momento";
}
