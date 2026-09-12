"use client";

/**
 * Conectar el sistema de facturación del que vive el agente financiero.
 *
 * Mismo patrón que el formulario del sitio: acción de servidor y
 * `useActionState`. El token nunca vuelve al navegador: el campo sale siempre
 * vacío, también al actualizar una conexión que ya existe.
 *
 * Son dos datos y una decisión. La decisión —«solo mirar»— está aquí y no
 * escondida en otra pantalla porque es la que separa a un agente que analiza de
 * uno que puede emitir documentos legales en nombre del cliente.
 */
import * as React from "react";
import { useActionState } from "react";
import { ChevronDown, CircleHelp, PlugZap, ShieldCheck } from "lucide-react";
import { Button, Input } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import { AvisoAjustes } from "./seccion-ajustes";

export function FormularioContabilidad({
  accion,
  usuario,
  soloLectura,
  puedeEditar,
}: {
  accion: (datos: FormData) => Promise<Resultado>;
  usuario: string;
  soloLectura: boolean;
  puedeEditar: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => accion(datos),
    null,
  );
  const id = React.useId();

  return (
    <form action={enviar} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-5" disabled={!puedeEditar}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-usuario`} className="text-base font-medium text-fg">
            Tu usuario de Alegra
          </label>
          <p className="text-2xs text-fg-muted">El correo con el que entras a Alegra.</p>
          <Input
            id={`${id}-usuario`}
            name="usuario"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="contabilidad@tunegocio.com"
            defaultValue={usuario}
            required
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-token`} className="text-base font-medium text-fg">
            Token de la API
          </label>
          <p className="text-2xs text-fg-muted">
            No es tu contraseña: es un token que puedes revocar cuando quieras.
          </p>
          <Input id={`${id}-token`} name="token" type="password" autoComplete="off" required />
          <details className="group mt-2 rounded-lg border border-[var(--border-subtle)] bg-inset">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
              <CircleHelp size={14} strokeWidth={2} aria-hidden />
              ¿Dónde está ese token?
              <ChevronDown
                size={14}
                strokeWidth={2}
                aria-hidden
                className="ml-auto transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
              />
            </summary>
            <ol className="flex list-decimal flex-col gap-1.5 px-3 pb-3 pl-8 text-sm text-fg-secondary">
              <li>Entra a Alegra con tu cuenta.</li>
              <li>Abre Configuración → API.</li>
              <li>Copia el token que aparece ahí y pégalo aquí.</li>
              <li>
                Si puedes, crea un usuario aparte para Strappy: así lo revocas sin tocar el tuyo.
              </li>
            </ol>
          </details>
        </div>

        <label
          htmlFor={`${id}-solo-lectura`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset p-3"
        >
          <input
            id={`${id}-solo-lectura`}
            name="solo_lectura"
            type="checkbox"
            defaultChecked={soloLectura}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-medium text-fg">Solo mirar</span>
            <span className="text-2xs text-fg-muted">
              Puede analizar tus cuentas y proponerte cosas, pero nunca emitir una factura ni
              registrar un pago, aunque tú se lo apruebes.
            </span>
          </span>
        </label>
      </fieldset>

      {pendiente ? (
        <AvisoAjustes>Entrando a Alegra para comprobar que los datos funcionan…</AvisoAjustes>
      ) : estado ? (
        <AvisoAjustes tono={estado.ok ? "exito" : "error"}>
          {estado.ok ? estado.mensaje : estado.error}
        </AvisoAjustes>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
        <Button
          type="submit"
          size="lg"
          loading={pendiente}
          loadingLabel="Probando conexión…"
          disabled={!puedeEditar}
        >
          <PlugZap size={16} strokeWidth={2} aria-hidden />
          {usuario ? "Probar y actualizar" : "Probar y conectar"}
        </Button>
        <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
          <ShieldCheck size={14} strokeWidth={2} aria-hidden />
          Probamos la conexión antes de guardar. El token se guarda cifrado.
        </span>
      </div>
    </form>
  );
}
