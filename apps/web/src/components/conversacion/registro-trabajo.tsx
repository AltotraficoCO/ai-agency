"use client";

/**
 * El registro de trabajo de un agente.
 *
 * Mientras trabaja se ve abierto y vivo: un punto que late, el paso en curso
 * girando y cada paso nuevo entrando desde abajo. Al terminar se recoge solo a
 * una línea —«Trabajó 6 pasos · 2 min»— para que la conversación no se llene de
 * detalle que ya no importa, y se vuelve a abrir con un clic. Si la persona lo
 * abre o lo cierra a mano, manda su elección.
 */
import * as React from "react";
import { Check, ChevronDown, CircleAlert, Clock, Loader2, Users, X } from "lucide-react";
import { cn } from "@strappy/ui";
import { duracionLegible, horaCorta } from "./tiempo";

export type EstadoPaso = "en_curso" | "hecho" | "error" | "esperando";

export type PasoVista = {
  readonly id: string;
  readonly etiqueta: string;
  readonly estado: EstadoPaso;
  readonly detalle?: string | null;
  /** ISO 8601. Sin fecha no se enseña hora ni duración. */
  readonly en?: string | null;
  /** Quién dio el paso: el propio agente, o un compañero al que pidió ayuda. */
  readonly agente?: { readonly slug: string; readonly nombre: string } | null;
};

/**
 * Los pasos, en tramos por quién los dio. El primer agente que aparece es el
 * dueño del encargo; cuando cambia, es que un compañero entró a ayudar, y ese
 * tramo se pinta aparte con su nombre para que se vea la conversación entre
 * los dos.
 */
type Tramo = { readonly agente: PasoVista["agente"]; readonly pasos: readonly PasoVista[] };

function tramosPorAgente(pasos: readonly PasoVista[]): Tramo[] {
  const salida: Tramo[] = [];
  for (const paso of pasos) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && (ultimo.agente?.slug ?? null) === (paso.agente?.slug ?? null)) {
      salida[salida.length - 1] = { agente: ultimo.agente, pasos: [...ultimo.pasos, paso] };
    } else {
      salida.push({ agente: paso.agente ?? null, pasos: [paso] });
    }
  }
  return salida;
}

export function RegistroTrabajo({
  pasos,
  activo,
  textoActivo = "Trabajando…",
  className,
}: {
  pasos: readonly PasoVista[];
  /** El agente sigue trabajando: animación viva y abierto por defecto. */
  activo: boolean;
  textoActivo?: string;
  className?: string;
}) {
  const [eleccion, setEleccion] = React.useState<boolean | null>(null);
  const idContenido = React.useId();

  const total = pasos.length;
  if (!activo && total === 0) return null;

  const abierto = eleccion ?? activo;
  const actual = [...pasos].reverse().find((p) => p.estado === "en_curso") ?? null;
  const conError = pasos.some((p) => p.estado === "error");
  const esperando = pasos.some((p) => p.estado === "esperando");
  const primero = pasos.find((p) => p.en)?.en ?? null;
  const ultimo = [...pasos].reverse().find((p) => p.en)?.en ?? null;
  const duracion = !activo && primero && ultimo ? duracionLegible(primero, ultimo) : null;
  const cuenta = `${total} ${total === 1 ? "paso" : "pasos"}`;

  const resumen = activo
    ? `${textoActivo}${total > 0 ? ` · ${cuenta}` : ""}`
    : `${esperando ? "Esperando tu respuesta" : "Trabajó"} · ${cuenta}${duracion ? ` · ${duracion}` : ""}`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border-2 bg-inset transition-colors duration-[var(--dur-base)]",
        activo
          ? "border-[color-mix(in_oklab,var(--brand),transparent_60%)]"
          : "border-[var(--border-subtle)]",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idContenido}
        onClick={() => setEleccion(!abierto)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-hover"
      >
        <IndicadorGeneral activo={activo} conError={conError} esperando={esperando} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-fg">{resumen}</span>
          {activo && actual ? (
            <span aria-live="polite" className="truncate text-2xs text-fg-muted">
              Ahora: {actual.etiqueta}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "shrink-0 text-fg-muted transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] motion-reduce:transition-none",
            abierto && "rotate-180",
          )}
        />
      </button>

      {/* grid-rows 0fr → 1fr anima la altura sin medirla en JavaScript. */}
      <div
        id={idContenido}
        className={cn(
          "grid transition-[grid-template-rows] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] motion-reduce:transition-none",
          abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden" {...(abierto ? {} : { inert: true })}>
          <ol className="flex flex-col gap-3 px-3 pb-3 pt-1">
            {total === 0 && activo ? (
              <li className="flex items-center gap-2.5 text-sm text-fg-muted">
                <IconoPaso estado="en_curso" />
                Preparándome para empezar…
              </li>
            ) : null}
            {tramosPorAgente(pasos).flatMap((tramo, t, tramos) => {
              const principal = tramos[0]?.agente?.slug ?? null;
              const deCompanero = tramo.agente != null && tramo.agente.slug !== principal;
              const cabecera = deCompanero ? (
                <li
                  key={`tramo-${t}`}
                  className="strappy-slide-up ml-[34px] mt-1 flex items-center gap-2 border-l-2 border-[color-mix(in_oklab,var(--brand),transparent_50%)] pl-3 text-2xs font-semibold uppercase tracking-wide text-primary-fg"
                >
                  <Users size={12} strokeWidth={2} aria-hidden />
                  {tramo.agente?.nombre} entra a ayudar
                </li>
              ) : null;
              return [cabecera, ...tramo.pasos.map((paso) => renderPaso(paso, deCompanero))].filter(Boolean);
            })}
          </ol>
        </div>
      </div>
    </div>
  );

  function renderPaso(paso: PasoVista, deCompanero: boolean) {
    const indice = pasos.indexOf(paso);
    return (
              <li
                key={paso.id}
                className={cn(
                  "strappy-slide-up relative flex gap-2.5",
                  deCompanero && "ml-[34px] border-l-2 border-[color-mix(in_oklab,var(--brand),transparent_50%)] pl-3",
                )}
              >
                {indice < total - 1 ? (
                  <span
                    aria-hidden
                    className="absolute left-[11px] top-7 bottom-[-10px] w-0.5 rounded-full bg-[var(--border-default)]"
                  />
                ) : null}
                <IconoPaso estado={paso.estado} />
                <div className="flex min-w-0 flex-1 flex-col pt-0.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        "text-sm",
                        paso.estado === "en_curso" ? "font-semibold text-fg" : "text-fg-secondary",
                        paso.estado === "error" && "text-danger-fg",
                      )}
                    >
                      {paso.etiqueta}
                    </span>
                    {paso.en ? (
                      <time suppressHydrationWarning className="tnum shrink-0 text-2xs text-fg-muted">
                        {horaCorta(paso.en)}
                      </time>
                    ) : null}
                  </div>
                  {paso.detalle ? (
                    <p className="break-words text-2xs text-fg-muted">{paso.detalle}</p>
                  ) : null}
                </div>
              </li>
    );
  }
}

/** El punto de la cabecera: late mientras trabaja; al acabar dice cómo acabó. */
function IndicadorGeneral({
  activo,
  conError,
  esperando,
}: {
  activo: boolean;
  conError: boolean;
  esperando: boolean;
}) {
  if (activo) {
    return (
      <span aria-hidden className="relative grid size-6 shrink-0 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/35 motion-reduce:animate-none" />
        <span className="relative size-3 rounded-full bg-primary shadow-glow" />
      </span>
    );
  }
  if (esperando) return <IconoPaso estado="esperando" />;
  if (conError) {
    return (
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-fg">
        <CircleAlert size={14} strokeWidth={2.25} />
      </span>
    );
  }
  return <IconoPaso estado="hecho" />;
}

function IconoPaso({ estado }: { estado: EstadoPaso }) {
  const base = "grid size-6 shrink-0 place-items-center rounded-full shadow-e1";
  switch (estado) {
    case "en_curso":
      return (
        <span aria-hidden className={cn(base, "bg-primary-soft text-primary-fg")}>
          <Loader2 size={14} strokeWidth={2.5} className="animate-spin motion-reduce:animate-none" />
        </span>
      );
    case "hecho":
      return (
        <span aria-hidden className={cn(base, "bg-success-soft text-success-fg")}>
          <Check size={14} strokeWidth={3} />
        </span>
      );
    case "error":
      return (
        <span aria-hidden className={cn(base, "bg-danger-soft text-danger-fg")}>
          <X size={14} strokeWidth={3} />
        </span>
      );
    case "esperando":
      return (
        <span aria-hidden className={cn(base, "bg-warning-soft text-warning-fg")}>
          <Clock size={14} strokeWidth={2.5} />
        </span>
      );
  }
}
