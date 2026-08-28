"use client";

/**
 * El panel del contacto.
 *
 * Lo que hay que saber de la persona al otro lado sin salir del hilo: quién es,
 * qué etiquetas lleva, quién la atiende, y el resumen que la IA se ha ido
 * haciendo de la conversación. En pantallas de menos de 1440 px se convierte en
 * un cajón: a esa anchura, robarle 320 px al hilo es robarle el producto.
 */
import * as React from "react";
import { CalendarClock, Phone, Plus, Sparkles, Tag as IconoTag, UserPlus } from "lucide-react";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Kbd,
  cn,
} from "@strappy/ui";
import type { Catalogos, Etiqueta, Hilo } from "@/lib/bandeja/tipos";
import { PALETA_ETIQUETAS } from "@/lib/bandeja/tipos";
import { fechaCompleta, soloFecha } from "./formato";

export type AccionesContacto = {
  asignar: (usuarioId: string | null) => void;
  etiquetar: (etiquetaId: string, poner: boolean) => void;
  crearEtiqueta: (nombre: string, color: string) => Promise<Etiqueta | null>;
};

export function PanelContacto({
  hilo,
  catalogos,
  acciones,
  refEtiquetas,
}: {
  hilo: Hilo;
  catalogos: Catalogos;
  acciones: AccionesContacto;
  refEtiquetas: React.RefObject<HTMLButtonElement | null>;
}) {
  const asignado = hilo.conversacion.asignado;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section className="flex flex-col items-center gap-2 text-center">
        <Avatar
          size="lg"
          tone="cliente"
          name={hilo.contacto.nombre}
          {...(hilo.conversacion.contacto.avatar ? { src: hilo.conversacion.contacto.avatar } : {})}
        />
        <div>
          <h2 className="text-lg font-semibold text-fg">{hilo.contacto.nombre}</h2>
          {hilo.contacto.telefono && (
            <p className="tnum flex items-center justify-center gap-1 text-sm text-fg-muted">
              <Phone size={12} strokeWidth={1.75} aria-hidden />
              {hilo.contacto.telefono}
            </p>
          )}
        </div>
        <p className="text-xs text-fg-muted">
          {hilo.conversacion.canal.nombre} · cliente desde el {soloFecha(hilo.contacto.creadoEl)}
        </p>
      </section>

      <Seccion titulo="Asignada a">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="w-full justify-start">
              {asignado ? (
                <>
                  <Avatar size="xs" tone="humano" name={asignado.nombre} />
                  {asignado.nombre}
                </>
              ) : (
                <>
                  <UserPlus size={15} strokeWidth={1.75} aria-hidden />
                  Sin asignar
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {/* Primera opción siempre, y por eso está escrita a mano y no sale
                del bucle de compañeros: asignarse a uno mismo es el 90 % de las
                asignaciones reales. */}
            <DropdownMenuItem onSelect={() => acciones.asignar(catalogos.yo.id)}>
              <Avatar size="xs" tone="humano" name={catalogos.yo.nombre} />
              Asignarme a mí
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {catalogos.miembros
              .filter((miembro) => miembro.id !== catalogos.yo.id)
              .map((miembro) => (
                <DropdownMenuItem key={miembro.id} onSelect={() => acciones.asignar(miembro.id)}>
                  <Avatar size="xs" tone="humano" name={miembro.nombre} />
                  {miembro.nombre}
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => acciones.asignar(null)}>Quitar la asignación</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Seccion>

      <Seccion
        titulo="Etiquetas"
        accion={
          <span className="flex items-center gap-1 text-2xs text-fg-muted">
            <Kbd>⌘</Kbd>
            <Kbd>L</Kbd>
          </span>
        }
      >
        <MenuEtiquetas
          hilo={hilo}
          catalogos={catalogos}
          acciones={acciones}
          refDisparador={refEtiquetas}
        />
      </Seccion>

      {hilo.resumen && (
        <Seccion titulo="Lo que la IA sabe de esta conversación">
          <p className="rounded-lg border border-[color-mix(in_oklab,var(--brand),transparent_70%)] bg-primary-soft p-3 text-sm text-fg">
            <Sparkles size={13} strokeWidth={1.75} aria-hidden className="mr-1 inline text-primary-fg" />
            {hilo.resumen}
          </p>
        </Seccion>
      )}

      {Object.keys(hilo.contacto.propiedades).length > 0 && (
        <Seccion titulo="Datos recogidos">
          <dl className="flex flex-col gap-1.5">
            {Object.entries(hilo.contacto.propiedades).map(([clave, valor]) => (
              <div key={clave} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-fg-muted">{clave}</dt>
                <dd className="min-w-0 truncate text-sm text-fg">{valor}</dd>
              </div>
            ))}
          </dl>
        </Seccion>
      )}

      <Seccion titulo="Actividad">
        <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary">
          {hilo.conversacion.ultimoEntrante && (
            <li className="flex items-center gap-2">
              <CalendarClock size={13} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
              Último mensaje del cliente: {fechaCompleta(hilo.conversacion.ultimoEntrante)}
            </li>
          )}
          {hilo.conversacion.ultimoSaliente && (
            <li className="flex items-center gap-2">
              <CalendarClock size={13} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
              Última respuesta: {fechaCompleta(hilo.conversacion.ultimoSaliente)}
            </li>
          )}
        </ul>
      </Seccion>
    </div>
  );
}

function Seccion({
  titulo,
  accion,
  children,
}: {
  titulo: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">{titulo}</h3>
        {accion}
      </div>
      {children}
    </section>
  );
}

/**
 * Etiquetas: elegir de las que hay o crear una nueva sobre la marcha.
 *
 * Los colores salen de la paleta de neutros teñidos y de ninguna otra parte. Si
 * una etiqueta pudiera ser roja, el rojo dejaría de significar «esto va mal» en
 * el resto de la pantalla.
 */
export function MenuEtiquetas({
  hilo,
  catalogos,
  acciones,
  refDisparador,
}: {
  hilo: Hilo;
  catalogos: Catalogos;
  acciones: AccionesContacto;
  refDisparador: React.RefObject<HTMLButtonElement | null>;
}) {
  const [nueva, setNueva] = React.useState("");
  const puestas = new Set(hilo.conversacion.etiquetas.map((e) => e.id));

  const crear = async () => {
    const nombre = nueva.trim();
    if (!nombre) return;
    const color = PALETA_ETIQUETAS[(catalogos.etiquetas.length + nombre.length) % PALETA_ETIQUETAS.length];
    const etiqueta = await acciones.crearEtiqueta(nombre, color?.hex ?? "#64748B");
    if (etiqueta) acciones.etiquetar(etiqueta.id, true);
    setNueva("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {hilo.conversacion.etiquetas.map((etiqueta) => (
          <button
            key={etiqueta.id}
            type="button"
            onClick={() => acciones.etiquetar(etiqueta.id, false)}
            title={`Quitar la etiqueta ${etiqueta.nombre}`}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-2xs text-fg"
            style={{
              borderColor: `color-mix(in oklab, ${etiqueta.color}, transparent 45%)`,
              backgroundColor: `color-mix(in oklab, ${etiqueta.color}, transparent 85%)`,
            }}
          >
            <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: etiqueta.color }} />
            {etiqueta.nombre}
          </button>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={refDisparador} variant="ghost" size="sm" className="justify-start">
            <IconoTag size={15} strokeWidth={1.75} aria-hidden />
            Etiquetar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {catalogos.etiquetas.map((etiqueta) => (
            <DropdownMenuItem
              key={etiqueta.id}
              onSelect={() => acciones.etiquetar(etiqueta.id, !puestas.has(etiqueta.id))}
            >
              <span
                aria-hidden
                className={cn("size-2 rounded-full", puestas.has(etiqueta.id) && "ring-2 ring-offset-1")}
                style={{ backgroundColor: etiqueta.color }}
              />
              {etiqueta.nombre}
              {puestas.has(etiqueta.id) && <span className="ml-auto text-2xs text-fg-muted">puesta</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="flex items-center gap-1.5 p-1">
            <Input
              value={nueva}
              placeholder="Nueva etiqueta"
              aria-label="Nombre de la etiqueta nueva"
              onChange={(evento) => setNueva(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter") {
                  evento.preventDefault();
                  void crear();
                }
              }}
              className="h-8"
            />
            <Button size="sm" variant="secondary" onClick={() => void crear()} disabled={!nueva.trim()}>
              <Plus size={14} strokeWidth={2} aria-hidden />
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
