"use client";

/**
 * Encender el modo Max en un agente.
 *
 * Max usa el modelo caro: acierta más a la primera en encargos largos y gasta
 * bastantes más créditos. Es una decisión del cliente, agente por agente, no
 * una restricción del plan: por eso está aquí, junto al agente, y no escondido
 * en facturación. Se dice lo que cuesta antes de encenderlo.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Toggle, cn } from "@strappy/ui";
import { cambiarModoAgente } from "@/lib/acciones-agente";

export function InterruptorMax({
  agentId,
  modo,
  planDePago,
}: {
  agentId: string;
  modo: "lite" | "max";
  /** En el gratuito no se ofrece: los créditos los ponemos nosotros. */
  planDePago: boolean;
}) {
  const router = useRouter();
  const [max, setMax] = React.useState(modo === "max");
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function cambiar(valor: boolean) {
    setMax(valor);
    setOcupado(true);
    setError(null);
    const r = await cambiarModoAgente(agentId, valor);
    setOcupado(false);
    if (!r.ok) {
      setMax(!valor);
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-inset p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
            max ? "bg-primary-soft text-primary-fg" : "bg-hover text-fg-muted",
          )}
        >
          <Sparkles size={16} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-fg">Modo Max</p>
          <p className="text-sm text-fg-muted">
            {planDePago
              ? "Usa el modelo más capaz. Acierta más a la primera en encargos largos y gasta bastantes más créditos."
              : "Disponible en los planes de pago. Usa el modelo más capaz para los encargos difíciles."}
          </p>
        </div>
        <Toggle
          checked={max}
          disabled={!planDePago || ocupado}
          onCheckedChange={(v) => void cambiar(v)}
          aria-label="Modo Max"
        />
      </div>
      {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
    </div>
  );
}
