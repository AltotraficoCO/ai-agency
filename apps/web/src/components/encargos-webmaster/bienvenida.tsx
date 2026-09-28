"use client";

import type { OficioEncargos } from "./oficios";
import type { SitioConectado } from "./comun";
import { FotoAgente } from "./foto-agente";

/** Lo que se ve antes del primer encargo: la invitación y los ejemplos. */
export function Bienvenida({
  nombreAgente,
  oficio,
  sitio,
  usarEjemplo,
}: {
  nombreAgente: string;
  oficio: OficioEncargos;
  sitio: SitioConectado | null;
  usarEjemplo: (ejemplo: string) => void;
}) {
  return (
    <div className="strappy-slide-up flex flex-col items-center gap-4 py-10 text-center">
      <FotoAgente src={oficio.foto} size={112} trabajando={false} />
      <div className="flex flex-col gap-1">
        <p className="font-display text-xl font-semibold text-fg">Encárgale algo a {nombreAgente}</p>
        <p className="max-w-[52ch] text-base text-fg-secondary">{oficio.invitacion}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {oficio.ejemplos.map((ejemplo) => (
          <button
            key={ejemplo}
            type="button"
            disabled={oficio.conexion.bloquea && !sitio}
            onClick={() => usarEjemplo(ejemplo)}
            className="cursor-pointer rounded-full border-2 border-border bg-raised px-3.5 py-2 text-sm text-fg-secondary shadow-e1 transition-[color,border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ejemplo}
          </button>
        ))}
      </div>
    </div>
  );
}
