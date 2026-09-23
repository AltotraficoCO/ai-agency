"use client";

/**
 * Encender Max desde donde se le encarga trabajo.
 *
 * El interruptor de la ficha sirve para configurar; este es para el momento en
 * que de verdad se decide: el cliente va a encargar algo difícil y quiere el
 * modelo bueno. Enseña lo que cuesta al pasar el ratón y no obliga a salir de
 * la conversación.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button, Tooltip, cn } from "@strappy/ui";
import { cambiarModoAgente } from "@/lib/acciones-agente";

export function BotonModo({
  agentId,
  modo,
  planDePago,
}: {
  agentId: string;
  modo: "lite" | "max";
  planDePago: boolean;
}) {
  const router = useRouter();
  const [max, setMax] = React.useState(modo === "max");
  const [ocupado, setOcupado] = React.useState(false);

  async function alternar() {
    if (!planDePago) return;
    const valor = !max;
    setMax(valor);
    setOcupado(true);
    const r = await cambiarModoAgente(agentId, valor);
    setOcupado(false);
    if (!r.ok) {
      setMax(!valor);
      window.alert(r.error);
      return;
    }
    router.refresh();
  }

  const ayuda = !planDePago
    ? "El modo Max está en los planes de pago: usa el modelo más capaz para los encargos difíciles."
    : max
      ? "Modo Max: usa el modelo más capaz. Acierta más a la primera en encargos largos y gasta más créditos. Pulsa para volver a Lite."
      : "Modo Lite: el modelo rápido y económico. Pulsa para cambiar a Max en los encargos difíciles.";

  return (
    <Tooltip content={ayuda}>
      <Button
        size="sm"
        variant={max ? "secondary" : "ghost"}
        onClick={() => void alternar()}
        disabled={!planDePago || ocupado}
        aria-label={`Modo ${max ? "Max" : "Lite"}`}
        className={cn(!max && "text-fg-muted")}
      >
        <Sparkles size={14} aria-hidden />
        {max ? "Max" : "Lite"}
      </Button>
    </Tooltip>
  );
}
