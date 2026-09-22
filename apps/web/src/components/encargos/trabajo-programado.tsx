"use client";

/**
 * El trabajo que el agente repite solo.
 *
 * Un programador que no se puede ver ni apagar es una trampa: por eso lo
 * primero es la lista de lo que ya está programado, con cuándo le toca, y solo
 * después el formulario para añadir otro.
 *
 * Dos decisiones de honestidad:
 *  - se dice **cuánto va a gastar** («unas 30 veces al mes»), porque cada
 *    ejecución es un encargo y cuesta créditos;
 *  - cuando el propio sistema lo pausó, se dice **por qué** (sin saldo, agente
 *    dado de baja), en vez de enseñar un interruptor apagado sin explicación.
 */
import * as React from "react";
import { useActionState } from "react";
import { CalendarClock, Pause, Play, Trash2 } from "lucide-react";
import { Button, Input, cn } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import type { ProgramadoVista } from "@/lib/programados/programados";

const DIAS = [
  { valor: 1, etiqueta: "lunes" },
  { valor: 2, etiqueta: "martes" },
  { valor: 3, etiqueta: "miércoles" },
  { valor: 4, etiqueta: "jueves" },
  { valor: 5, etiqueta: "viernes" },
  { valor: 6, etiqueta: "sábado" },
  { valor: 7, etiqueta: "domingo" },
] as const;

const MOTIVOS: Record<string, string> = {
  sin_creditos: "En pausa: el espacio se quedó sin créditos. Recarga y reanúdalo.",
  agente_de_baja: "En pausa: diste de baja a este agente. Vuelve a contratarlo para reanudarlo.",
};

const CLASE_CAMPO =
  "h-10 rounded-lg border border-[var(--border-default)] bg-surface px-3 text-base text-fg " +
  "transition-colors focus:border-[var(--border-strong)] focus:outline-none";

export function TrabajoProgramado({
  nombreAgente,
  programados,
  sinMarco = false,
  sugerencia,
  programar,
  cambiarEstado,
  quitar,
}: {
  nombreAgente: string;
  programados: readonly ProgramadoVista[];
  /** Lo que más vale la pena dejarle programado a este oficio. */
  sugerencia?: string | undefined;
  programar: (datos: FormData) => Promise<Resultado>;
  cambiarEstado: (id: string, activa: boolean) => Promise<Resultado>;
  quitar: (id: string) => Promise<Resultado>;
  /** true dentro de un panel que ya pone marco y título. */
  sinMarco?: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => {
      // La zona se añade aquí, al enviar, y no en el primer render: en el
      // servidor no existe, y pintarla distinta en cada lado rompe la
      // hidratación. «A las 8» tiene que ser a las 8 del reloj del cliente.
      datos.set("zona", zonaDelNavegador());
      const r = await programar(datos);
      if (r.ok) formulario.current?.reset();
      return r;
    },
    null,
  );
  const formulario = React.useRef<HTMLFormElement>(null);
  const campoTexto = React.useRef<HTMLTextAreaElement>(null);
  const id = React.useId();
  const [frecuencia, setFrecuencia] = React.useState("diaria");

  return (
    <section
      className={cn(
        "flex flex-col gap-4",
        !sinMarco && "rounded-2xl border border-[var(--border-subtle)] bg-surface p-5",
      )}
    >
      <header className={cn("flex items-center gap-2", sinMarco && "sr-only")}>
        <CalendarClock size={18} strokeWidth={2} aria-hidden className="text-fg-secondary" />
        <h2 className="text-lg font-medium text-fg">Trabajo que hace solo</h2>
      </header>

      {programados.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          {nombreAgente} todavía espera a que le pidas cada cosa. Dile algo que tenga que repetir y lo
          hará sin que se lo recuerdes.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {programados.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-inset p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-base text-fg">{p.titulo}</p>
                <p className="text-2xs text-fg-muted">
                  {p.cadencia}
                  {p.activa ? ` · la próxima, ${cuando(p.proximaEn)}` : ""}
                </p>
                {!p.activa && p.motivoPausa ? (
                  <p className="text-2xs text-fg-secondary">{MOTIVOS[p.motivoPausa]}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void cambiarEstado(p.id, !p.activa)}
                  aria-label={p.activa ? "Pausar" : "Reanudar"}
                >
                  {p.activa ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                  {p.activa ? "Pausar" : "Reanudar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void quitar(p.id)}
                  aria-label="Quitar"
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form ref={formulario} action={enviar} className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-texto`} className="text-base font-medium text-fg">
            ¿Qué quieres que haga cada vez?
          </label>
          <textarea
            ref={campoTexto}
            id={`${id}-texto`}
            name="texto"
            rows={2}
            required
            placeholder={sugerencia ?? "Revisa cómo va todo y dime lo importante."}
            className="min-h-20 rounded-lg border border-[var(--border-default)] bg-surface px-3 py-2 text-base text-fg transition-colors focus:border-[var(--border-strong)] focus:outline-none"
          />
          {/* La sugerencia se ofrece para rellenar, nunca se programa sola:
              cada ejecución gasta créditos del cliente y eso lo decide él. */}
          {sugerencia ? (
            <button
              type="button"
              onClick={() => {
                if (!campoTexto.current) return;
                campoTexto.current.value = sugerencia;
                campoTexto.current.focus();
              }}
              className="self-start text-2xs text-fg-secondary underline decoration-dotted underline-offset-4 transition-colors hover:text-fg"
            >
              Usar la sugerencia: «{sugerencia}»
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-frecuencia`} className="text-sm text-fg-secondary">
              ¿Cada cuánto?
            </label>
            <select
              id={`${id}-frecuencia`}
              name="frecuencia"
              value={frecuencia}
              onChange={(e) => setFrecuencia(e.target.value)}
              className={CLASE_CAMPO}
            >
              <option value="diaria">Todos los días</option>
              <option value="semanal">Una vez por semana</option>
              <option value="mensual">Una vez al mes</option>
            </select>
          </div>

          {frecuencia === "semanal" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-dia`} className="text-sm text-fg-secondary">
                ¿Qué día?
              </label>
              <select id={`${id}-dia`} name="dia_semana" defaultValue={1} className={CLASE_CAMPO}>
                {DIAS.map((d) => (
                  <option key={d.valor} value={d.valor}>
                    {d.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {frecuencia === "mensual" ? (
            <div className="flex w-28 flex-col gap-1.5">
              <label htmlFor={`${id}-diames`} className="text-sm text-fg-secondary">
                ¿Qué día?
              </label>
              <Input id={`${id}-diames`} name="dia_mes" type="number" min={1} max={28} defaultValue={1} />
            </div>
          ) : null}

          <div className="flex w-28 flex-col gap-1.5">
            <label htmlFor={`${id}-hora`} className="text-sm text-fg-secondary">
              ¿A qué hora?
            </label>
            <Input id={`${id}-hora`} name="hora" type="number" min={0} max={23} defaultValue={8} />
          </div>

          <Button type="submit" disabled={pendiente}>
            {pendiente ? "Programando…" : "Programar"}
          </Button>
        </div>

        <p className="text-2xs text-fg-muted">
          Cada vez que lo haga es un encargo normal y gasta créditos: {vecesDe(frecuencia)}. Si te
          quedas sin saldo se pausa solo y te lo dice.
        </p>

        {estado && !estado.ok ? (
          <p className="text-sm text-[var(--color-danger,#b42318)]">{estado.error}</p>
        ) : null}
        {estado?.ok && estado.mensaje ? (
          <p className="text-sm text-fg-secondary">{estado.mensaje}</p>
        ) : null}
      </form>
    </section>
  );
}

/** La del navegador del cliente; si no la da, la de Colombia. */
function zonaDelNavegador(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota";
  } catch {
    return "America/Bogota";
  }
}

function vecesDe(frecuencia: string): string {
  if (frecuencia === "diaria") return "unas 30 veces al mes";
  if (frecuencia === "semanal") return "unas 4 veces al mes";
  return "una vez al mes";
}

/** «mañana a las 8:00», «el lunes a las 8:00». Lo que diría una persona. */
function cuando(iso: string): string {
  const fecha = new Date(iso);
  const hoy = new Date();
  const dia = 24 * 60 * 60 * 1000;
  const diferencia = Math.round(
    (new Date(fecha.toDateString()).getTime() - new Date(hoy.toDateString()).getTime()) / dia,
  );
  const hora = fecha.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  if (diferencia === 0) return `hoy a las ${hora}`;
  if (diferencia === 1) return `mañana a las ${hora}`;
  if (diferencia < 7) return `el ${fecha.toLocaleDateString("es-CO", { weekday: "long" })} a las ${hora}`;
  return `${fecha.toLocaleDateString("es-CO", { day: "numeric", month: "long" })} a las ${hora}`;
}
