"use client";

/**
 * Qué agentes de WhatsApp usan esta base.
 *
 * El interruptor cambia al instante (optimista) y vuelve atrás si el servidor
 * lo rechaza: esperar a la base para mover un interruptor se siente roto.
 */
import * as React from "react";
import { Bot, Sparkles } from "lucide-react";
import { Avatar, Badge, Toggle, toast } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { accionConectarAgente } from "@/lib/conocimiento/acciones";
import type { AgenteConectable } from "@/lib/conocimiento/tipos";

const FALLO = { ok: false as const, error: "No pudimos cambiarlo. Vuelve a intentarlo." };

export function PanelAgentes({
  cerebroId,
  agentes,
  onCambio,
}: {
  cerebroId: string;
  agentes: readonly AgenteConectable[];
  onCambio: () => void;
}) {
  // Solo lo que la persona acaba de tocar. En cuanto el servidor coincide, manda
  // el servidor: el valor optimista solo se usa mientras aún difieren.
  const [cambios, setCambios] = React.useState<Record<string, boolean>>({});
  const estadoDe = (agente: AgenteConectable): boolean => cambios[agente.id] ?? agente.conectado;
  const conectados = agentes.filter(estadoDe).length;

  const alternar = async (agente: AgenteConectable, conectado: boolean) => {
    setCambios((previos) => ({ ...previos, [agente.id]: conectado }));
    const resultado = await accionConectarAgente(cerebroId, agente.id, conectado).catch(() => FALLO);
    if (!resultado.ok) {
      setCambios((previos) => {
        const siguiente = { ...previos };
        delete siguiente[agente.id];
        return siguiente;
      });
      toast.error(resultado.error);
      return;
    }
    toast.success(conectado ? `${agente.nombre} ya usa este conocimiento` : `${agente.nombre} dejó de usarlo`);
    // Confirmado: se suelta el valor optimista y a partir de aquí manda el servidor.
    setCambios((previos) => {
      const siguiente = { ...previos };
      delete siguiente[agente.id];
      return siguiente;
    });
    onCambio();
  };

  return (
    <section
      aria-labelledby="agentes-titulo"
      className="strappy-slide-up rounded-xl border border-border bg-raised p-5 shadow-e1 [animation-delay:90ms]"
    >
      <div className="flex flex-col gap-1 pb-4">
        <h2 id="agentes-titulo" className="flex items-center gap-2 text-lg font-semibold text-fg">
          <Bot size={18} aria-hidden className="text-fg-muted" />
          Agentes que lo usan
        </h2>
        <p className="text-sm text-fg-secondary">
          {agentes.length === 0
            ? "Solo los agentes conectados responden con este conocimiento."
            : `${conectados} de ${agentes.length} conectados. Solo esos responden con esta información.`}
        </p>
      </div>

      {agentes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm text-fg-secondary">Todavía no tienes agentes de WhatsApp que puedan usarlo.</p>
          <EnlaceBoton href="/" size="sm" variant="secondary">
            <Sparkles size={14} aria-hidden />
            Crear un agente con Strap
          </EnlaceBoton>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {agentes.map((agente) => {
            const conectado = estadoDe(agente);
            const idEtiqueta = `agente-${agente.id}`;
            return (
              <li
                key={agente.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover"
              >
                <Avatar name={agente.nombre} size="md" tone="ia" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span id={idEtiqueta} className="truncate text-base font-medium text-fg">
                    {agente.nombre}
                  </span>
                  {!agente.publicado ? (
                    <Badge tone="neutral" className="w-fit">
                      Sin publicar
                    </Badge>
                  ) : null}
                </div>
                <Toggle
                  checked={conectado}
                  aria-labelledby={idEtiqueta}
                  onCheckedChange={(valor) => void alternar(agente, valor)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
