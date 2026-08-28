"use client";

/**
 * Formularios de ajustes.
 *
 * Todos siguen el mismo patrón: `<form action={accion}>` con una acción de
 * servidor y `useActionState` para el mensaje. Sin `fetch` a mano y sin estado
 * duplicado: el formulario funciona aunque el JavaScript aún no haya cargado, y
 * el resultado siempre viene del servidor, que es quien manda.
 */
import * as React from "react";
import { useActionState } from "react";
import { Button, Input, Textarea } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";

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
    <p className={`text-sm ${estado.ok ? "text-success-fg" : "text-danger-fg"}`} role="status">
      {estado.ok ? (estado.mensaje ?? "Guardado.") : estado.error}
    </p>
  );
}

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

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-fg">Nombre del espacio</span>
        <Input name="nombre" defaultValue={nombre} disabled={!puedeEditar} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-fg">Zona horaria</span>
        <span className="text-2xs text-fg-muted">
          Decide a qué hora empieza un día en tus informes y en el horario de atención.
        </span>
        <Input name="zona" defaultValue={zona} placeholder="America/Bogota" disabled={!puedeEditar} />
      </label>

      <fieldset className="flex flex-col gap-2" disabled={!puedeEditar}>
        <legend className="text-sm font-medium text-fg">Horario de atención</legend>
        <p className="text-2xs text-fg-muted">
          Fuera de este horario el agente sigue respondiendo, pero avisa de cuándo contestará una
          persona: prometer atención inmediata a las tres de la mañana es lo que genera la queja.
        </p>
        <div className="flex flex-wrap gap-2">
          {dias.map((d) => (
            <label key={d.clave} className="flex items-center gap-1.5 text-sm text-fg-secondary">
              <input
                type="checkbox"
                name="dias"
                value={d.clave}
                defaultChecked={horario.dias.includes(d.clave)}
                className="size-4 accent-[var(--brand)]"
              />
              {d.nombre}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            Desde
            <Input type="time" name="desde" defaultValue={horario.desde} className="w-32" />
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            Hasta
            <Input type="time" name="hasta" defaultValue={horario.hasta} className="w-32" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Mensaje fuera de horario</span>
          <Textarea
            name="fuera_de_horario"
            rows={2}
            defaultValue={horario.fueraDeHorario}
            placeholder="Te leemos mañana a partir de las 9:00."
          />
        </label>
      </fieldset>

      <Aviso estado={estado} />
      {puedeEditar && (
        <div>
          <Button type="submit" loading={pendiente} loadingLabel="Guardando…">
            Guardar cambios
          </Button>
        </div>
      )}
    </form>
  );
}

// ── Topes de gasto ──────────────────────────────────────────────────────────

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

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <p className="text-sm text-fg-secondary">
        Los topes existen para que un bucle entre dos automatismos no se coma el saldo de un mes en
        cinco minutos. El saldo solo avisa cuando ya se gastó; el tope lo para antes.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Máximo por día</span>
          <span className="text-2xs text-fg-muted">Déjalo vacío para no poner tope.</span>
          <Input
            name="diario"
            type="number"
            min={1}
            defaultValue={diario ?? ""}
            disabled={!puedeEditar}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Máximo por conversación</span>
          <span className="text-2xs text-fg-muted">Corta un hilo que se descontrola.</span>
          <Input
            name="por_conversacion"
            type="number"
            min={1}
            defaultValue={porConversacion ?? ""}
            disabled={!puedeEditar}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={!puedeEditar}>
        <legend className="text-sm font-medium text-fg">Al quedarte sin créditos</legend>
        <label className="flex items-start gap-2 text-sm text-fg-secondary">
          <input
            type="radio"
            name="parada"
            value="dura"
            defaultChecked={parada === "dura"}
            className="mt-1 accent-[var(--brand)]"
          />
          <span>
            <strong className="text-fg">Parar el agente</strong> (recomendado). Deja de responder solo.
            Tu bandeja sigue abierta y tu equipo puede contestar a mano.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-fg-secondary">
          <input
            type="radio"
            name="parada"
            value="blanda"
            defaultChecked={parada === "blanda"}
            className="mt-1 accent-[var(--brand)]"
          />
          <span>
            <strong className="text-fg">Seguir y facturar después</strong>. El agente no se detiene y lo
            consumido de más se cobra en la siguiente factura.
          </span>
        </label>
      </fieldset>

      <Aviso estado={estado} />
      {puedeEditar && (
        <div>
          <Button type="submit" variant="secondary" loading={pendiente} loadingLabel="Guardando…">
            Guardar topes
          </Button>
        </div>
      )}
    </form>
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

  return (
    <form action={enviar} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Correo</span>
          <Input name="correo" type="email" placeholder="persona@tuempresa.com" disabled={!puedeEditar} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Papel</span>
          <select
            name="rol"
            disabled={!puedeEditar}
            className="h-9 rounded-md border border-border bg-raised px-2 text-base text-fg"
          >
            {papeles.map((p) => (
              <option key={p.clave} value={p.clave}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
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
        defaultValue={papelActual}
        disabled={!puedeEditar}
        onChange={() => formulario.current?.requestSubmit()}
        className="h-8 rounded-md border border-border bg-raised px-2 text-sm text-fg"
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
}: {
  cuerpo: Record<string, string>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
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
    <span className="inline-flex flex-col gap-1">
      <Button size={size} variant={variant} loading={cargando} onClick={ir}>
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
      <Button size="sm" variant="secondary" loading={cargando} onClick={ir}>
        Gestionar pago y facturas
      </Button>
      {error && <span className="max-w-64 text-2xs text-fg-muted">{error}</span>}
    </span>
  );
}
