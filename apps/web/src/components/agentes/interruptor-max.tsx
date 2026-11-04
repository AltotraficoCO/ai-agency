"use client";

/**
 * El modo del agente en su ficha.
 *
 * Es el mismo control que en la pantalla de encargos y que en Strap: una sola
 * forma de elegir modelo en todo el producto. Aquí va con su explicación al
 * lado, porque es donde se configura el agente con calma.
 */
import { BotonModo } from "./boton-modo";

export function InterruptorMax({
  agentId,
  modo,
}: {
  agentId: string;
  modo: "lite" | "max";
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-inset p-4">
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-fg">Qué modelo usa</p>
        <p className="text-sm text-fg-muted">
          Lite es rápido y económico. Max usa el modelo más capaz: acierta más a la primera en encargos largos y gasta
          bastantes más créditos.
        </p>
      </div>
      <BotonModo agentId={agentId} modo={modo} />
    </div>
  );
}
