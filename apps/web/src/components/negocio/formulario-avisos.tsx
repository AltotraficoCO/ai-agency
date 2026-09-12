"use client";

/**
 * Configurar a dónde te avisa el Webmaster.
 *
 * Tres decisiones de esta pantalla:
 *
 *  · **La plantilla se explica, no se da por sabida.** Nadie que tenga un
 *    negocio sabe qué es una plantilla de WhatsApp ni por qué hace falta. Se
 *    cuenta en dos líneas y se le da el texto listo para copiar y pegar en Meta.
 *  · **No se puede encender sin plantilla.** Sería prometer avisos que Meta no
 *    dejaría salir.
 *  · **La prueba está aquí mismo.** Es la única forma de saber si funciona antes
 *    de que se caiga la web de verdad.
 */
import * as React from "react";
import { useActionState } from "react";
import { BellRing, ChevronDown, CircleHelp, Copy, Send } from "lucide-react";
import { Button, Input } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import { AvisoAjustes } from "./seccion-ajustes";

/** El texto que el cliente tiene que pedir aprobado en Meta, tal cual. */
const CUERPO_SUGERIDO =
  "Soy el Webmaster de tu sitio. {{1}}\n\nQué puedes hacer: {{2}}";

export function FormularioAvisos({
  guardar,
  probar,
  destino,
  plantilla,
  idioma,
  activo,
  numeros,
  puedeEnviar,
  puedeEditar,
}: {
  guardar: (datos: FormData) => Promise<Resultado>;
  probar: (datos: FormData) => Promise<Resultado>;
  destino: string;
  plantilla: string;
  idioma: string;
  activo: boolean;
  numeros: readonly { numero: string; nombre: string | null; activo: boolean }[];
  puedeEnviar: boolean;
  puedeEditar: boolean;
}) {
  const id = React.useId();
  const [estado, enviar, pendiente] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => guardar(datos),
    null,
  );
  const [prueba, enviarPrueba, probando] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => probar(datos),
    null,
  );

  const [plantillaEscrita, setPlantillaEscrita] = React.useState(plantilla);
  const [copiado, setCopiado] = React.useState(false);
  const sinPlantilla = plantillaEscrita.trim() === "";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(CUERPO_SUGERIDO);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles —navegador antiguo o permiso denegado— el texto está a
      // la vista para seleccionarlo a mano: no hay nada que avisar.
    }
  };

  return (
    <form action={enviar} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-5" disabled={!puedeEditar}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-destino`} className="text-base font-medium text-fg">
            ¿A qué número te avisamos?
          </label>
          <p className="text-2xs text-fg-muted">
            El tuyo, con el indicativo del país. No tiene que ser el número de atención al cliente.
          </p>
          <Input
            id={`${id}-destino`}
            name="destino"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="573001234567"
            defaultValue={destino}
            required
          />
          {numeros.length > 0 && (
            <p className="text-2xs text-fg-muted">
              Tu WhatsApp conectado es {numeros.map((n) => n.numero).join(", ")}. Puedes usar ese u
              otro.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-plantilla`} className="text-base font-medium text-fg">
            Nombre de la plantilla aprobada
          </label>
          <p className="text-2xs text-fg-muted">
            WhatsApp solo deja que un negocio escriba primero con un texto aprobado por Meta. Créalo
            una vez y sirve para todos los avisos.
          </p>
          <Input
            id={`${id}-plantilla`}
            name="plantilla"
            placeholder="aviso_del_sitio"
            defaultValue={plantilla}
            onChange={(e) => setPlantillaEscrita(e.currentTarget.value)}
            required
          />

          <details className="group mt-2 rounded-lg border border-[var(--border-subtle)] bg-inset">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
              <CircleHelp size={14} strokeWidth={2} aria-hidden />
              ¿Cómo creo esa plantilla?
              <ChevronDown
                size={14}
                strokeWidth={2}
                aria-hidden
                className="ml-auto transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
              />
            </summary>
            <div className="flex flex-col gap-3 px-3 pb-3">
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg-secondary">
                <li>Entra al Administrador de WhatsApp de Meta y abre Plantillas de mensajes.</li>
                <li>
                  Crea una nueva con categoría <strong>Utilidad</strong> y ponle de nombre{" "}
                  <code className="rounded bg-hover px-1">aviso_del_sitio</code>.
                </li>
                <li>Pega este texto como cuerpo, con sus dos huecos:</li>
              </ol>
              <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-raised p-3">
                <pre className="whitespace-pre-wrap text-sm text-fg">{CUERPO_SUGERIDO}</pre>
                <Button type="button" variant="ghost" size="sm" onClick={copiar}>
                  <Copy size={14} strokeWidth={2} aria-hidden />
                  {copiado ? "Copiado" : "Copiar el texto"}
                </Button>
              </div>
              <p className="text-2xs text-fg-muted">
                El primer hueco lo rellenamos con lo que pasó y el segundo con lo que puedes hacer.
                Meta suele aprobarla en unos minutos.
              </p>
            </div>
          </details>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-idioma`} className="text-base font-medium text-fg">
            Idioma de la plantilla
          </label>
          <p className="text-2xs text-fg-muted">
            El que elegiste en Meta al crearla. Normalmente <code>es</code>.
          </p>
          <Input
            id={`${id}-idioma`}
            name="idioma"
            placeholder="es"
            defaultValue={idioma || "es"}
          />
        </div>

        <label
          htmlFor={`${id}-activo`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset p-3"
        >
          <input
            id={`${id}-activo`}
            name="activo"
            type="checkbox"
            defaultChecked={activo}
            disabled={sinPlantilla}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-medium text-fg">Avisarme por WhatsApp</span>
            <span className="text-2xs text-fg-muted">
              {sinPlantilla
                ? "Necesitas una plantilla aprobada antes de encender los avisos."
                : "Como mucho cuatro avisos por hora, y solo cuando algo cambia de verdad."}
            </span>
          </span>
        </label>

        <AvisoAjustes tono="aviso">
          Estos mensajes salen de tu propio número, así que <strong>Meta te los cobra a ti</strong>,
          igual que cualquier conversación que empieza tu negocio. Nosotros no revendemos mensajes.
        </AvisoAjustes>

        {!puedeEnviar && (
          <AvisoAjustes>
            Todavía no tienes un número de WhatsApp conectado y activo, así que no podremos enviar
            nada. Conéctalo en Ajustes → Canales.
          </AvisoAjustes>
        )}
      </fieldset>

      {pendiente ? (
        <AvisoAjustes>Guardando…</AvisoAjustes>
      ) : estado ? (
        <AvisoAjustes tono={estado.ok ? "exito" : "error"}>
          {estado.ok ? estado.mensaje : estado.error}
        </AvisoAjustes>
      ) : null}

      {probando ? (
        <AvisoAjustes>Enviando el mensaje de prueba…</AvisoAjustes>
      ) : prueba ? (
        <AvisoAjustes tono={prueba.ok ? "exito" : "error"}>
          {prueba.ok ? prueba.mensaje : prueba.error}
        </AvisoAjustes>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
        <Button type="submit" size="lg" loading={pendiente} loadingLabel="Guardando…" disabled={!puedeEditar}>
          <BellRing size={16} strokeWidth={2} aria-hidden />
          Guardar
        </Button>
        <Button
          type="submit"
          formAction={enviarPrueba}
          variant="secondary"
          size="lg"
          loading={probando}
          loadingLabel="Enviando…"
          disabled={!puedeEditar || !puedeEnviar}
        >
          <Send size={16} strokeWidth={2} aria-hidden />
          Enviarme una prueba
        </Button>
      </div>
    </form>
  );
}
