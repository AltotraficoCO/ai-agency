"use client";

/**
 * La pantalla de inicio.
 *
 * No es un panel de control: es un chat. No hay tarjetas de métricas, ni
 * accesos directos, ni un estado vacío que te felicite por no tener nada. Hay
 * una pregunta —«¿qué construimos hoy?»— y sitio para contestarla.
 *
 * Un panel le pide al cliente que sepa qué quiere y dónde pulsar. Un chat solo
 * le pide que hable, que es lo único que sabe hacer el primer día.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, BookOpen, MessageCircle, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "@strappy/ui";
import { CHIPS_INTENCION, type ModoConstruccion, type ResumenHilo } from "@/lib/meta/tipos";
import { Composer } from "./composer";
import { Orbe } from "./orbe";

const ICONOS: Readonly<Record<string, LucideIcon>> = {
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
    <div className="mx-auto flex w-full max-w-[760px] flex-col items-center gap-8 px-5 py-16">
      <Orbe size={56} pose="saludando" />

      <h1 className="text-center text-4xl font-semibold tracking-tightest text-fg">
        Hola {nombre}, ¿qué construimos hoy?
      </h1>

      <div className="w-full">
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
      </div>

      <div className="flex w-full flex-wrap justify-center gap-2">
        {CHIPS_INTENCION.map((chip) => {
          const Icono = ICONOS[chip.icono] ?? Sparkles;
          return (
            <button
              key={chip.id}
              type="button"
              disabled={abriendo}
              onClick={() => void arrancar(chip.mensaje)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-raised px-3.5 py-2 text-base text-fg-secondary transition-colors duration-[--dur-fast] hover:border-border-strong hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              <Icono size={15} strokeWidth={1.75} aria-hidden />
              {chip.etiqueta}
            </button>
          );
        })}
      </div>

      {hilos.length > 0 ? (
        <section className="w-full pt-4">
          <h2 className="pb-2 text-2xs uppercase tracking-wide text-fg-muted">
            Conversaciones recientes
          </h2>
          <ul className="flex flex-col">
            {hilos.map((hilo) => (
              <li key={hilo.id}>
                <Link
                  href={`/c/${hilo.id}`}
                  className="-mx-2 flex items-center justify-between gap-4 rounded-lg px-2 py-2.5 transition-colors hover:bg-hover"
                >
                  <span className="min-w-0 truncate text-base text-fg">{hilo.titulo}</span>
                  <span className="shrink-0 text-sm text-fg-muted">
                    {hilo.publicado ? "Publicado" : hilo.etiquetaFase}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
