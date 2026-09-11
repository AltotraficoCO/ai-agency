"use client";

/**
 * El composer y el selector de modo.
 *
 * Noventa y seis píxeles de alto, radio 2xl y el borde que se tiñe de marca y
 * brilla al enfocar. Es alto a propósito: invita a escribir una frase de verdad —«quiero
 * que atienda pedidos de mi panadería por WhatsApp»— y no una palabra suelta.
 * Un composer de una línea produce mensajes de una línea.
 *
 * El selector es Lite/Max, NUNCA un modelo. La persona elige cuánto quiere
 * gastar; qué modelo responde a cada tarea lo decide el sistema desde
 * `model_tiers`. Enseñar nombres de modelos convertiría una decisión de
 * negocio en una de ingeniería, y nos ataría a un proveedor delante del
 * cliente.
 */
import * as React from "react";
import { ArrowUp, Lock, Zap } from "lucide-react";
import { IconButton, Tooltip, cn } from "@strappy/ui";
import type { ModoConstruccion } from "@/lib/meta/tipos";

export interface ComposerProps {
  valor: string;
  onCambio: (valor: string) => void;
  onEnviar: () => void;
  modo: ModoConstruccion;
  onModo: (modo: ModoConstruccion) => void;
  /** Sin Max en el plan, el botón queda con candado y ofrece ampliar. */
  maxDisponible: boolean;
  onAmpliarPlan?: () => void;
  ocupado?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function Composer({
  valor,
  onCambio,
  onEnviar,
  modo,
  onModo,
  maxDisponible,
  onAmpliarPlan,
  ocupado = false,
  placeholder = "Cuéntame qué necesitas…",
  autoFocus = false,
}: ComposerProps) {
  const [enfocado, setEnfocado] = React.useState(false);
  const puedeEnviar = valor.trim().length > 0 && !ocupado;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border bg-raised p-3 transition-[border-color,box-shadow] duration-[--dur-base]",
        enfocado ? "border-primary shadow-glow" : "border-border hover:border-border-strong",
      )}
    >
      <textarea
        value={valor}
        autoFocus={autoFocus}
        onChange={(evento) => onCambio(evento.target.value)}
        onFocus={() => setEnfocado(true)}
        onBlur={() => setEnfocado(false)}
        onKeyDown={(evento) => {
          // Enter envía; Shift+Enter salta de línea. Es un chat, no un editor.
          if (evento.key === "Enter" && !evento.shiftKey) {
            evento.preventDefault();
            if (puedeEnviar) onEnviar();
          }
        }}
        placeholder={placeholder}
        rows={3}
        aria-label="Mensaje para Strap"
        className="h-[96px] w-full resize-none bg-transparent px-1 text-md text-fg outline-none placeholder:text-fg-muted"
      />

      <div className="flex items-center justify-between gap-2">
        <SelectorDeModo
          modo={modo}
          onModo={onModo}
          maxDisponible={maxDisponible}
          {...(onAmpliarPlan ? { onAmpliarPlan } : {})}
        />
        <IconButton
          label="Enviar"
          variant="primary"
          disabled={!puedeEnviar}
          loading={ocupado}
          onClick={onEnviar}
        >
          <ArrowUp size={18} strokeWidth={2} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

export function SelectorDeModo({
  modo,
  onModo,
  maxDisponible,
  onAmpliarPlan,
}: {
  modo: ModoConstruccion;
  onModo: (modo: ModoConstruccion) => void;
  maxDisponible: boolean;
  onAmpliarPlan?: () => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Modo de construcción"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-inset p-0.5"
    >
      <BotonModo
        activo={modo === "lite"}
        onClick={() => onModo("lite")}
        etiqueta="Lite"
        descripcion="Rápido y económico. Suficiente para la mayoría."
      />
      {maxDisponible ? (
        <BotonModo
          activo={modo === "max"}
          onClick={() => onModo("max")}
          etiqueta="Max"
          descripcion="Los modelos de frontera. Para agentes con matices."
          icono={<Zap size={13} strokeWidth={2} aria-hidden />}
        />
      ) : (
        <Tooltip content="Max viene con los planes de pago. Consume más créditos por respuesta.">
          <button
            type="button"
            onClick={onAmpliarPlan}
            className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-sm text-fg-muted transition-colors hover:text-fg-secondary"
          >
            <Lock size={13} strokeWidth={2} aria-hidden />
            Max
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function BotonModo({
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
          activo
            ? "bg-primary text-on-primary"
            : "text-fg-secondary hover:bg-hover hover:text-fg",
        )}
      >
        {icono}
        {etiqueta}
      </button>
    </Tooltip>
  );
}
