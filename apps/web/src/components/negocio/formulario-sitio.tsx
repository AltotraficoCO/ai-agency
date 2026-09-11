"use client";

/**
 * Conectar el WordPress que cuida el Webmaster.
 *
 * Mismo patrón que los demás formularios de ajustes: acción de servidor y
 * `useActionState`. La contraseña nunca vuelve al navegador: el campo sale
 * siempre vacío, también al editar un sitio ya conectado.
 *
 * Va en tres pasos numerados porque son tres datos que salen de sitios
 * distintos, y el tercero —la contraseña de aplicación— es el que nadie sabe
 * de dónde sacar: su guía está pegada al campo, no en otra página.
 */
import * as React from "react";
import { useActionState } from "react";
import { ChevronDown, CircleHelp, PlugZap, ShieldCheck } from "lucide-react";
import { Button, Input } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import { AvisoAjustes } from "./seccion-ajustes";

export function FormularioSitio({
  accion,
  url,
  usuario,
  puedeEditar,
}: {
  accion: (datos: FormData) => Promise<Resultado>;
  url: string;
  usuario: string;
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
        <Paso
          numero={1}
          etiqueta="Dirección del sitio"
          ayuda="Tal como la escribes en el navegador."
          htmlFor={`${id}-url`}
        >
          <Input
            id={`${id}-url`}
            name="url"
            inputMode="url"
            placeholder="https://misitio.com"
            defaultValue={url}
            required
          />
        </Paso>

        <Paso
          numero={2}
          etiqueta="Usuario de WordPress"
          ayuda="Un administrador del sitio: el Webmaster podrá hacer lo que ese usuario pueda hacer."
          htmlFor={`${id}-usuario`}
        >
          <Input id={`${id}-usuario`} name="usuario" autoComplete="username" defaultValue={usuario} required />
        </Paso>

        <Paso
          numero={3}
          etiqueta="Contraseña de aplicación"
          ayuda="No es tu contraseña de siempre: es una aparte que puedes revocar cuando quieras."
          htmlFor={`${id}-contrasena`}
          ultimo
        >
          <Input id={`${id}-contrasena`} name="contrasena" type="password" autoComplete="off" required />
          <details className="group mt-2 rounded-lg border border-[var(--border-subtle)] bg-inset">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
              <CircleHelp size={14} strokeWidth={2} aria-hidden />
              ¿Cómo la creo?
              <ChevronDown
                size={14}
                strokeWidth={2}
                aria-hidden
                className="ml-auto transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
              />
            </summary>
            <ol className="flex list-decimal flex-col gap-1.5 px-3 pb-3 pl-8 text-sm text-fg-secondary">
              <li>Entra al escritorio de tu WordPress (misitio.com/wp-admin).</li>
              <li>Ve a Usuarios → Perfil.</li>
              <li>Baja hasta «Contraseñas de aplicación», escribe «Strappy» y pulsa «Añadir nueva».</li>
              <li>Copia la contraseña que aparece y pégala aquí.</li>
            </ol>
          </details>
        </Paso>
      </fieldset>

      {pendiente ? (
        <AvisoAjustes>Entrando a tu sitio para comprobar que todo funciona…</AvisoAjustes>
      ) : estado ? (
        <AvisoAjustes tono={estado.ok ? "exito" : "error"}>
          {estado.ok ? estado.mensaje : estado.error}
        </AvisoAjustes>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
        <Button type="submit" size="lg" loading={pendiente} loadingLabel="Probando conexión…" disabled={!puedeEditar}>
          <PlugZap size={16} strokeWidth={2} aria-hidden />
          {url ? "Probar y actualizar" : "Probar y conectar"}
        </Button>
        <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
          <ShieldCheck size={14} strokeWidth={2} aria-hidden />
          Probamos la conexión antes de guardar. La contraseña se guarda cifrada.
        </span>
      </div>
    </form>
  );
}

function Paso({
  numero,
  etiqueta,
  ayuda,
  htmlFor,
  ultimo = false,
  children,
}: {
  numero: number;
  etiqueta: string;
  ayuda: string;
  htmlFor: string;
  ultimo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-3">
      <div className="flex flex-col items-center">
        <span className="grid size-7 place-items-center rounded-full border border-border bg-page text-sm font-semibold text-fg tnum">
          {numero}
        </span>
        {!ultimo ? <span aria-hidden className="mt-1 w-px flex-1 bg-[var(--border-subtle)]" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 pb-1">
        <label htmlFor={htmlFor} className="pt-1 text-base font-medium text-fg">
          {etiqueta}
        </label>
        <p className="text-2xs text-fg-muted">{ayuda}</p>
        {children}
      </div>
    </div>
  );
}
