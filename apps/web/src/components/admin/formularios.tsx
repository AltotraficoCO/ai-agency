"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, Input, Textarea } from "@strappy/ui";
import type { ConfigCobro } from "@strappy/core/recargas";
import { AvisoAjustes } from "@/components/negocio/seccion-ajustes";
import type { ResultadoAdmin } from "@/lib/plataforma/acciones";

type Accion = (datos: FormData) => Promise<ResultadoAdmin>;

/**
 * Con `<form action>` React vacía el formulario al terminar, también si hubo un
 * error: una errata obligaría a volver a pegar todas las llaves. Aquí solo se
 * vacía si salió bien, y así un secreto no se queda escrito en la pantalla.
 */
function useAccion(accion: Accion) {
  const ref = React.useRef<HTMLFormElement>(null);
  const [estado, enviar, pendiente] = useActionState<ResultadoAdmin | null, FormData>(
    async (_p, datos) => accion(datos),
    null,
  );
  const alEnviar = (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    React.startTransition(() => enviar(datos));
  };
  React.useEffect(() => {
    if (estado?.ok) ref.current?.reset();
  }, [estado]);
  return { ref, estado, alEnviar, pendiente };
}

function Resultado({ estado }: { estado: ResultadoAdmin | null }) {
  if (!estado) return null;
  return <AvisoAjustes tono={estado.ok ? "exito" : "error"}>{estado.ok ? estado.mensaje : estado.error}</AvisoAjustes>;
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {etiqueta}
      </label>
      {children(id)}
      {ayuda && <p className="text-2xs text-fg-muted">{ayuda}</p>}
    </div>
  );
}

export function FormularioCobro({ config, accion }: { config: ConfigCobro; accion: Accion }) {
  const { ref, estado, alEnviar, pendiente } = useAccion(accion);
  const numero = (nombre: keyof ConfigCobro, etiqueta: string, ayuda: string) => (
    <Campo etiqueta={etiqueta} ayuda={ayuda}>
      {(id) => <Input id={id} name={nombre} type="number" min={0} step={1} required defaultValue={String(config[nombre])} />}
    </Campo>
  );
  return (
    <form ref={ref} onSubmit={alEnviar} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {numero("minimoUsd", "Recarga mínima (USD)", "También para el monto propio de la recarga automática.")}
        {numero("maximoUsd", "Recarga máxima (USD)", "Evita que un dedo de más cobre una cifra absurda.")}
        <Campo etiqueta="Montos de la recarga automática (USD)" ayuda="Separados por comas. Siempre se admite uno propio.">
          {(id) => <Input id={id} name="montosAutomaticos" required defaultValue={config.montosAutomaticos.join(", ")} />}
        </Campo>
        {numero("umbralAviso", "Aviso de saldo bajo (créditos)", "Por debajo de esto el cliente ve el aviso y recibe un correo.")}
        {numero(
          "umbralSaldoAcabado",
          "Saldo acabado (créditos)",
          "Por debajo de esto salta la recarga automática. En cero, un resto que no cubre ningún cobro la dejaría sin saltar.",
        )}
        {numero("cobrosPorDia", "Recargas automáticas por día", "Al llegar aquí se apaga sola: tanto gasto debe verlo una persona.")}
        {numero("rechazosParaApagar", "Rechazos seguidos para apagarla", "Insistir no arregla una tarjeta.")}
        {numero("esperaTrasRechazoMin", "Espera tras un rechazo (minutos)", "Antes de volver a intentar el cobro.")}
      </div>
      <Resultado estado={estado} />
      <div>
        <Button type="submit" loading={pendiente} loadingLabel="Guardando…">
          Guardar
        </Button>
      </div>
    </form>
  );
}

export function FormularioLlaves({
  actuales,
  accion,
}: {
  actuales: { publica: string; privada: string; integridad: string; eventos: string };
  accion: Accion;
}) {
  const { ref, estado, alEnviar, pendiente } = useAccion(accion);
  const secreto = (nombre: "privada" | "integridad" | "eventos", etiqueta: string, ejemplo: string) => (
    <Campo etiqueta={etiqueta} ayuda={actuales[nombre] ? `Guardado: termina en ${actuales[nombre]}. Déjalo vacío para conservarlo.` : "Sin configurar."}>
      {(id) => <Input id={id} name={nombre} type="password" autoComplete="off" placeholder={ejemplo} />}
    </Campo>
  );
  return (
    <form ref={ref} onSubmit={alEnviar} className="flex flex-col gap-5" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Llave pública" ayuda="No es secreta: viaja al navegador del cliente.">
          {(id) => <Input id={id} name="publica" defaultValue={actuales.publica} placeholder="pub_test_…" />}
        </Campo>
        {secreto("privada", "Llave privada", "prv_test_…")}
        {secreto("integridad", "Secreto de integridad", "test_integrity_…")}
        {secreto("eventos", "Secreto de eventos", "test_events_…")}
      </div>
      <Resultado estado={estado} />
      <div>
        <Button type="submit" loading={pendiente} loadingLabel="Guardando…">
          Guardar llaves
        </Button>
      </div>
    </form>
  );
}

export function FormularioAjuste({
  workspaceId,
  nonce,
  accion,
}: {
  workspaceId: string;
  nonce: string;
  accion: Accion;
}) {
  const { ref, estado, alEnviar, pendiente } = useAccion(accion);
  return (
    <form ref={ref} onSubmit={alEnviar} className="flex flex-col gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="nonce" value={nonce} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Operación">
          {(id) => (
            <select
              id={id}
              name="operacion"
              className="h-9 cursor-pointer rounded-md border border-border bg-page px-2.5 text-base text-fg"
            >
              <option value="dar">Dar créditos</option>
              <option value="quitar">Quitar créditos</option>
            </select>
          )}
        </Campo>
        <Campo etiqueta="Créditos" ayuda="1.000 créditos = 1 USD. No cuenta como venta.">
          {(id) => <Input id={id} name="creditos" type="number" min={1} step={1} required />}
        </Campo>
      </div>
      <Campo etiqueta="Motivo" ayuda="Queda en el libro del cliente y en la bitácora.">
        {(id) => <Textarea id={id} name="motivo" rows={2} required minLength={5} />}
      </Campo>
      <Resultado estado={estado} />
      <div>
        <Button type="submit" variant="secondary" loading={pendiente} loadingLabel="Aplicando…">
          Aplicar ajuste
        </Button>
      </div>
    </form>
  );
}

export function FormularioEstado({
  workspaceId,
  suspendido,
  accion,
}: {
  workspaceId: string;
  suspendido: boolean;
  accion: Accion;
}) {
  const { ref, estado, alEnviar, pendiente } = useAccion(accion);
  return (
    <form
      ref={ref}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        if (!suspendido && !window.confirm("¿Suspender esta cuenta? Sus agentes se detienen y sus usuarios no podrán entrar.")) {
          e.preventDefault();
          return;
        }
        alEnviar(e);
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="operacion" value={suspendido ? "reactivar" : "suspender"} />
      {!suspendido && (
        <Campo etiqueta="Motivo">
          {(id) => <Textarea id={id} name="motivo" rows={2} required minLength={5} />}
        </Campo>
      )}
      <Resultado estado={estado} />
      <div>
        <Button type="submit" variant={suspendido ? "primary" : "secondary"} loading={pendiente} loadingLabel="Aplicando…">
          {suspendido ? "Reactivar cuenta" : "Suspender cuenta"}
        </Button>
      </div>
    </form>
  );
}
