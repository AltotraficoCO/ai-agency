"use client";

/**
 * La foto de un agente de WhatsApp.
 *
 * Diez personajes de plastilina: al crearlo, Strap le asigna uno; aquí la
 * persona lo cambia con un clic. Se guarda al elegir, sin botón de guardar: es
 * una decisión pequeña y se ve el resultado al instante.
 */
import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn, toast } from "@strappy/ui";
import { cambiarFotoAgente } from "@/lib/acciones-agente";
import { AVATARES_WHATSAPP, AVATAR_POR_DEFECTO } from "@/lib/avatares";

export function SelectorFoto({
  agentId,
  actual,
  nombre,
}: {
  agentId: string;
  actual: string | null;
  nombre: string;
}) {
  const router = useRouter();
  const [elegida, setElegida] = React.useState(actual ?? AVATAR_POR_DEFECTO);
  const [pendiente, iniciar] = React.useTransition();

  const elegir = (foto: string): void => {
    if (foto === elegida || pendiente) return;
    const anterior = elegida;
    setElegida(foto);
    iniciar(async () => {
      const resultado = await cambiarFotoAgente(agentId, foto);
      if (!resultado.ok) {
        setElegida(anterior);
        toast.error(resultado.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section
      aria-labelledby="foto-agente"
      className="strappy-slide-up flex flex-col gap-4 rounded-xl border border-border bg-raised p-4 sm:flex-row sm:items-center"
    >
      <div className="flex items-center gap-3 sm:w-48 sm:flex-col sm:items-start">
        <Image
          src={elegida}
          alt={`Foto de ${nombre}`}
          width={96}
          height={96}
          className="size-20 shrink-0 object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.35)] sm:size-24"
        />
        <div className="flex flex-col gap-0.5">
          <h3 id="foto-agente" className="text-base font-semibold text-fg">
            Su foto
          </h3>
          <p className="text-sm text-fg-muted">Así lo reconocerás en tus listas.</p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Elige la foto del agente" className="grid flex-1 grid-cols-5 gap-2">
        {AVATARES_WHATSAPP.map((foto, indice) => {
          const marcada = foto === elegida;
          return (
            <button
              key={foto}
              type="button"
              role="radio"
              aria-checked={marcada}
              aria-label={`Foto ${indice + 1}`}
              disabled={pendiente}
              onClick={() => elegir(foto)}
              className={cn(
                "relative grid aspect-square cursor-pointer place-items-center rounded-lg border bg-inset p-1 transition-[transform,border-color,background-color] duration-[var(--dur-fast)]",
                "hover:-translate-y-0.5 hover:border-border-strong motion-reduce:hover:translate-y-0 disabled:cursor-wait",
                marcada ? "border-primary bg-primary-soft" : "border-border",
              )}
            >
              <Image src={foto} alt="" width={64} height={64} className="size-full object-contain" />
              {marcada ? (
                <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-[var(--fg-on-brand)]">
                  <Check size={12} strokeWidth={3} aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
