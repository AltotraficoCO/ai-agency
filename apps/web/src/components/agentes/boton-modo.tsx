"use client";

/**
 * Lite o Max, desde donde se le encarga trabajo al agente.
 *
 * Mismo control que el de Strap en Inicio, a propósito: es la misma decisión
 * (qué modelo trabaja) y no tiene por qué verse de dos maneras. Lo que cambia
 * es que aquí se guarda en el agente, no en la conversación, porque un agente
 * contratado trabaja también solo, cuando toca su trabajo programado.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Zap } from "lucide-react";
import { Tooltip, cn } from "@strappy/ui";
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
  const [actual, setActual] = React.useState(modo);
  const [ocupado, setOcupado] = React.useState(false);

  async function elegir(valor: "lite" | "max") {
    if (valor === actual || ocupado) return;
    const previo = actual;
    setActual(valor);
    setOcupado(true);
    const r = await cambiarModoAgente(agentId, valor === "max");
    setOcupado(false);
    if (!r.ok) {
      setActual(previo);
      window.alert(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Modo del agente"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-inset p-0.5"
    >
      <Opcion
        activo={actual === "lite"}
        onClick={() => void elegir("lite")}
        etiqueta="Lite"
        descripcion="Rápido y económico. Suficiente para la mayoría de los encargos."
      />
      {planDePago ? (
        <Opcion
          activo={actual === "max"}
          onClick={() => void elegir("max")}
          etiqueta="Max"
          descripcion="El modelo más capaz. Acierta más a la primera en encargos largos y gasta bastantes más créditos."
          icono={<Zap size={13} strokeWidth={2} aria-hidden />}
        />
      ) : (
        <Tooltip content="Max viene con los planes de pago. Usa el modelo más capaz y consume más créditos.">
          <span className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-sm text-fg-muted">
            <Lock size={13} strokeWidth={2} aria-hidden />
            Max
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function Opcion({
  activo,
  onClick,
  etiqueta,
  descripcion,
  icono,
}: {
  activo: boolean;
  onClick: () => void;
  etiqueta: string;
  descripcion: string;
  icono?: React.ReactNode;
}) {
  return (
    <Tooltip content={descripcion}>
      <button
        type="button"
        role="radio"
        aria-checked={activo}
        onClick={onClick}
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-3 text-sm transition-colors duration-[--dur-fast]",
          activo ? "bg-primary text-on-primary" : "text-fg-secondary hover:bg-hover hover:text-fg",
        )}
      >
        {icono}
        {etiqueta}
      </button>
    </Tooltip>
  );
}
