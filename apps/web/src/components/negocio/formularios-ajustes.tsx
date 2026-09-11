"use client";

/**
 * Formularios de ajustes.
 *
 * Todos siguen el mismo patrón: `<form action={accion}>` con una acción de
 * servidor y `useActionState` para el mensaje. Sin `fetch` a mano y sin estado
 * duplicado: el formulario funciona aunque el JavaScript aún no haya cargado, y
 * el resultado siempre viene del servidor, que es quien manda.
 *
 * Las etiquetas van siempre visibles y la ayuda debajo del campo: un
 * placeholder que desaparece al escribir no es una etiqueta.
 */
import * as React from "react";
import { useActionState } from "react";
import { Building2, Clock, ExternalLink } from "lucide-react";
import { Button, Input, Textarea, cn } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import { AvisoAjustes, SeccionAjustes } from "./seccion-ajustes";

type Accion = (datos: FormData) => Promise<Resultado>;

function useAccion(accion: Accion) {
  return useActionState<Resultado | null, FormData>(
    async (_previo, datos) => accion(datos),
    null,
  );
}

function Aviso({ estado }: { estado: Resultado | null }) {
  if (!estado) return null;
  return (
    <AvisoAjustes tono={estado.ok ? "exito" : "error"}>
      {estado.ok ? (estado.mensaje ?? "Guardado.") : estado.error}
    </AvisoAjustes>
  );
}

function Campo({
  etiqueta,
  ayuda,
  htmlFor,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {etiqueta}
      </label>
      {children}
      {ayuda ? <p className="text-2xs text-fg-muted">{ayuda}</p> : null}
    </div>
  );
}

const SELECT =
  "h-9 cursor-pointer rounded-md border border-border bg-page px-2.5 text-base text-fg transition-colors duration-[var(--dur-fast)] hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60";

// ── Espacio ─────────────────────────────────────────────────────────────────

export function FormularioEspacio({
  accion,
  nombre,
  zona,
  horario,
  dias,
  puedeEditar,
}: {
  accion: Accion;
  nombre: string;
  zona: string;
  horario: { dias: readonly string[]; desde: string; hasta: string; fueraDeHorario: string };
  dias: readonly { clave: string; nombre: string }[];
  puedeEditar: boolean;
}) {
  const [estado, enviar, pendiente] = useAccion(accion);
  const id = React.useId();

  return (
    <form action={enviar} className="flex flex-col gap-6">
      <SeccionAjustes
        titulo="Datos del espacio"
        descripcion="Cómo se llama tu negocio dentro de Strappy y en qué hora vive."
        icono={<Building2 size={18} strokeWidth={1.75} aria-hidden />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre del espacio" htmlFor={`${id}-nombre`}>
            <Input id={`${id}-nombre`} name="nombre" defaultValue={nombre} disabled={!puedeEditar} />
          </Campo>
          <Campo
            etiqueta="Zona horaria"
            ayuda="Marca cuándo empieza el día en tus informes y en el horario."
            htmlFor={`${id}-zona`}
          >
            <Input
              id={`${id}-zona`}
              name="zona"
              defaultValue={zona}
              placeholder="America/Bogota"
              disabled={!puedeEditar}
            />
          </Campo>
        </div>
      </SeccionAjustes>

      {/* Fuera de horario el agente sigue respondiendo, pero avisa de cuándo
          contestará una persona: prometer atención inmediata a las tres de la
          mañana es lo que genera la queja. */}
      <SeccionAjustes
        titulo="Horario de atención"
        descripcion="Fuera de este horario tu agente sigue respondiendo y avisa de cuándo contestará tu equipo."
        icono={<Clock size={18} strokeWidth={1.75} aria-hidden />}
      >
        <fieldset className="flex flex-col gap-5" disabled={!puedeEditar}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-fg">Días con alguien del equipo</legend>
            <div className="flex flex-wrap gap-2">
              {dias.map((d) => (
                <label
                  key={d.clave}
                  className={cn(
                    "cursor-pointer select-none rounded-full border border-border px-3.5 py-1.5 text-sm text-fg-secondary",
                    "transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:text-fg",
                    "has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-fg",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--border-focus)]",
                    "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    name="dias"
                    value={d.clave}
                    defaultChecked={horario.dias.includes(d.clave)}
                    className="sr-only"
                  />
                  {d.nombre}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Desde" htmlFor={`${id}-desde`}>
              <Input id={`${id}-desde`} type="time" name="desde" defaultValue={horario.desde} />
            </Campo>
            <Campo etiqueta="Hasta" htmlFor={`${id}-hasta`}>
              <Input id={`${id}-hasta`} type="time" name="hasta" defaultValue={horario.hasta} />
            </Campo>
          </div>

          <Campo
            etiqueta="Mensaje fuera de horario"
            ayuda="Lo que dice tu agente cuando no hay nadie del equipo."
            htmlFor={`${id}-fuera`}
          >
            <Textarea
              id={`${id}-fuera`}
              name="fuera_de_horario"
              rows={2}
              defaultValue={horario.fueraDeHorario}
              placeholder="Te leemos mañana a partir de las 9:00."
            />
          </Campo>
        </fieldset>
      </SeccionAjustes>

      <Aviso estado={estado} />
      {puedeEditar && (
        <div className="flex justify-end">
          <Button type="submit" size="lg" loading={pendiente} loadingLabel="Guardando…">
            Guardar cambios
          </Button>
        </div>
      )}
    </form>
  );
}

// ── Topes de gasto ──────────────────────────────────────────────────────────

/**
 * Los topes existen para que un bucle entre dos automatismos no se coma el
 * saldo de un mes en cinco minutos. El saldo solo avisa cuando ya se gastó; el
 * tope lo para antes.
 */
export function FormularioLimites({
  accion,
  diario,
  porConversacion,
  parada,
  puedeEditar,
}: {
  accion: Accion;
  diario: number | null;
  porConversacion: number | null;
  parada: "dura" | "blanda";
  puedeEditar: boolean;
}) {
  const [estado, enviar, pendiente] = useAccion(accion);
  const id = React.useId();

  return (
    <form action={enviar} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Máximo por día" ayuda="En créditos. Déjalo vacío para no poner tope." htmlFor={`${id}-diario`}>
          <Input
            id={`${id}-diario`}
            name="diario"
            type="number"
            min={1}
            defaultValue={diario ?? ""}
            disabled={!puedeEditar}
          />
        </Campo>
        <Campo
          etiqueta="Máximo por conversación"
          ayuda="Corta un hilo que se descontrola."
          htmlFor={`${id}-conversacion`}
        >
          <Input
            id={`${id}-conversacion`}
            name="por_conversacion"
            type="number"
            min={1}
            defaultValue={porConversacion ?? ""}
            disabled={!puedeEditar}
          />
        </Campo>
      </div>

      <fieldset className="flex flex-col" disabled={!puedeEditar}>
        <legend className="mb-2 text-sm font-medium text-fg">Al quedarte sin créditos</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <OpcionTarjeta
            name="parada"
            value="dura"
            defaultChecked={parada === "dura"}
            titulo="Parar el agente"
            marca="Recomendado"
            descripcion="Deja de responder solo. Tu bandeja sigue abierta y tu equipo contesta a mano."
          />
          <OpcionTarjeta
            name="parada"
            value="blanda"
            defaultChecked={parada === "blanda"}
            titulo="Seguir y facturar después"
            descripcion="El agente no se detiene y lo consumido de más se cobra en la siguiente factura."
          />
        </div>
      </fieldset>

      <Aviso estado={estado} />
      {puedeEditar && (
        <div>
          <Button type="submit" loading={pendiente} loadingLabel="Guardando…">
            Guardar topes
          </Button>
        </div>
      )}
    </form>
  );
}

function OpcionTarjeta({
  name,
  value,
  defaultChecked,
  titulo,
  descripcion,
  marca,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  titulo: string;
  descripcion: string;
  marca?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-page p-3.5",
        "transition-colors duration-[var(--dur-fast)] hover:border-border-strong",
        "has-[:checked]:border-primary has-[:checked]:bg-primary-soft",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-base font-medium text-fg">
          {titulo}
          {marca ? (
            <span className="rounded-full bg-hover px-2 py-0.5 text-2xs font-medium text-fg-secondary">
              {marca}
            </span>
          ) : null}
        </span>
        <span className="text-sm text-fg-secondary">{descripcion}</span>
      </span>
    </label>
  );
}

// ── Equipo ──────────────────────────────────────────────────────────────────

export function FormularioInvitar({
  accion,
  papeles,
  puedeEditar,
}: {
  accion: Accion;
  papeles: readonly { clave: string; nombre: string; descripcion: string }[];
  puedeEditar: boolean;
}) {
  const [estado, enviar, pendiente] = useAccion(accion);
  const id = React.useId();

  return (
    <form action={enviar} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Campo etiqueta="Correo" htmlFor={`${id}-correo`}>
          <Input
            id={`${id}-correo`}
            name="correo"
            type="email"
            placeholder="persona@tuempresa.com"
            disabled={!puedeEditar}
          />
        </Campo>
        <Campo etiqueta="Papel" htmlFor={`${id}-rol`}>
          <select id={`${id}-rol`} name="rol" disabled={!puedeEditar} className={SELECT}>
            {papeles.map((p) => (
              <option key={p.clave} value={p.clave}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Button type="submit" loading={pendiente} loadingLabel="Invitando…" disabled={!puedeEditar}>
          Invitar
        </Button>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

export function BotonAccion({
  accion,
  campos,
  children,
  variant = "ghost",
}: {
  accion: Accion;
  campos: Record<string, string>;
  children: React.ReactNode;
  variant?: "ghost" | "secondary" | "danger";
}) {
  const [estado, enviar, pendiente] = useAccion(accion);
  return (
    <form action={enviar} className="inline-flex items-center gap-2">
      {Object.entries(campos).map(([clave, valor]) => (
        <input key={clave} type="hidden" name={clave} value={valor} />
      ))}
      <Button type="submit" size="sm" variant={variant} loading={pendiente}>
        {children}
      </Button>
      {estado && !estado.ok && <span className="text-2xs text-danger-fg">{estado.error}</span>}
    </form>
  );
}

export function SelectorPapel({
  accion,
  miembroId,
  papelActual,
  papeles,
  puedeEditar,
}: {
  accion: Accion;
  miembroId: string;
  papelActual: string;
  papeles: readonly { clave: string; nombre: string }[];
  puedeEditar: boolean;
}) {
  const [estado, enviar] = useAccion(accion);
  const formulario = React.useRef<HTMLFormElement>(null);

  return (
    <form action={enviar} ref={formulario} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={miembroId} />
      <select
        name="rol"
        aria-label="Papel en el espacio"
        defaultValue={papelActual}
        disabled={!puedeEditar}
        onChange={() => formulario.current?.requestSubmit()}
        className={cn(SELECT, "h-8 text-sm")}
      >
        {papeles.map((p) => (
          <option key={p.clave} value={p.clave}>
            {p.nombre}
          </option>
        ))}
      </select>
      {estado && !estado.ok && <span className="text-2xs text-danger-fg">{estado.error}</span>}
    </form>
  );
}

// ── Pagos ───────────────────────────────────────────────────────────────────

/**
 * Botones de pago.
 *
 * Piden la sesión a nuestra API y redirigen. Si Stripe no está configurado, la
 * API responde con un motivo legible y se muestra AQUÍ: el cliente se entera de
 * que la instalación no tiene pagos en vez de quedarse mirando una pestaña en
 * blanco.
 */
export function BotonPago({
  cuerpo,
  children,
  variant = "primary",
  size = "sm",
  anchoCompleto = false,
}: {
  cuerpo: Record<string, string>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  /** Para los botones que cierran una tarjeta de precio. */
  anchoCompleto?: boolean;
}) {
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function ir() {
    setCargando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const datos = (await respuesta.json()) as { url?: string; error?: string };
      if (datos.url) {
        window.location.href = datos.url;
        return;
      }
      setError(datos.error ?? "No se pudo iniciar el pago.");
    } catch {
      setError("No se pudo contactar con la pasarela de pago.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <span className={cn("flex-col gap-1", anchoCompleto ? "flex w-full" : "inline-flex")}>
      <Button
        size={size}
        variant={variant}
        loading={cargando}
        onClick={ir}
        className={anchoCompleto ? "w-full" : undefined}
      >
        {children}
      </Button>
      {error && <span className="max-w-64 text-2xs text-warning-fg">{error}</span>}
    </span>
  );
}

export function BotonPortal() {
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function ir() {
    setCargando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/stripe/portal", { method: "POST" });
      const datos = (await respuesta.json()) as { url?: string; error?: string };
      if (datos.url) {
        window.location.href = datos.url;
        return;
      }
      setError(datos.error ?? "No se pudo abrir el portal.");
    } catch {
      setError("No se pudo contactar con la pasarela de pago.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="secondary" loading={cargando} onClick={ir}>
        Gestionar pago y facturas
        <ExternalLink size={14} strokeWidth={2} aria-hidden />
      </Button>
      {error && <span className="max-w-64 text-2xs text-fg-muted">{error}</span>}
    </span>
  );
}
