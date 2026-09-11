"use client";

/**
 * El historial de una conversación con un agente.
 *
 * Panel a la izquierda, como en cualquier chat: lo último arriba, agrupado por
 * «Hoy», «Ayer», «Esta semana» y «Antes», con buscador y un botón para empezar
 * algo nuevo. Se pliega a una columna estrecha y lo recuerda en el navegador;
 * en el teléfono no ocupa sitio: se abre como cajón con un botón flotante.
 */
import * as React from "react";
import Link from "next/link";
import { History, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from "lucide-react";
import { Badge, IconButton, Tooltip, cn } from "@strappy/ui";
import { ORDEN_GRUPOS, grupoDeFecha, haceRelativo, type GrupoFecha } from "./tiempo";

export type TonoHistorial = "neutral" | "ia" | "exito" | "aviso" | "error";

export type ItemHistorial = {
  readonly id: string;
  readonly titulo: string;
  /** ISO 8601. */
  readonly fecha: string;
  readonly estado?: { readonly texto: string; readonly tono: TonoHistorial; readonly vivo?: boolean };
  /** Con enlace navega; sin él avisa con `onElegir`. */
  readonly href?: string;
};

export type AccionNuevo = { readonly etiqueta: string; readonly href?: string; readonly onClick?: () => void };

const oyentes = new Set<() => void>();

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function PanelHistorial({
  titulo,
  items,
  activoId,
  onElegir,
  nuevo,
  claveAlmacen,
  vacio = "Todavía no hay nada aquí.",
  pie,
}: {
  titulo: string;
  items: readonly ItemHistorial[];
  activoId?: string | null;
  onElegir?: (id: string) => void;
  nuevo?: AccionNuevo;
  /** Clave de localStorage para recordar si está plegado. */
  claveAlmacen: string;
  vacio?: string;
  /** Acciones al pie del panel, p. ej. vaciar el historial. */
  pie?: React.ReactNode;
}) {
  const leer = React.useCallback((): boolean => {
    try {
      return window.localStorage.getItem(claveAlmacen) === "1";
    } catch {
      return false;
    }
  }, [claveAlmacen]);
  const plegado = React.useSyncExternalStore(suscribir, leer, () => false);
  const alternar = (): void => {
    try {
      window.localStorage.setItem(claveAlmacen, leer() ? "0" : "1");
    } catch {
      // Sin almacenamiento no se recuerda, pero el panel sigue funcionando.
    }
    for (const avisar of oyentes) avisar();
  };

  const [movilAbierto, setMovilAbierto] = React.useState(false);
  const cuenta = items.length;

  const elegir = (id: string): void => {
    setMovilAbierto(false);
    onElegir?.(id);
  };

  return (
    <>
      {plegado ? (
        <aside
          aria-label={titulo}
          className="hidden h-full w-14 shrink-0 flex-col items-center gap-2 border-r-2 border-[var(--border-subtle)] bg-nav py-3 md:flex"
        >
          <Tooltip content={`Abrir ${titulo.toLowerCase()}`} side="right">
            <IconButton label={`Abrir ${titulo.toLowerCase()}`} onClick={alternar} className="cursor-pointer">
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          {nuevo ? <BotonNuevo nuevo={nuevo} compacto /> : null}
          <span className="relative mt-1 grid size-9 place-items-center text-fg-muted" title={`${cuenta} en el historial`}>
            <History size={18} strokeWidth={1.75} aria-hidden />
            {cuenta > 0 ? (
              <span className="tnum absolute -right-1 -top-1 min-w-4 rounded-full bg-hover px-1 text-center text-[10px] font-semibold leading-4 text-fg-secondary">
                {cuenta > 99 ? "99+" : cuenta}
              </span>
            ) : null}
          </span>
        </aside>
      ) : (
        <aside
          aria-label={titulo}
          className="hidden h-full w-72 shrink-0 flex-col border-r-2 border-[var(--border-subtle)] bg-nav md:flex"
        >
          <Contenido
            titulo={titulo}
            items={items}
            activoId={activoId ?? null}
            onElegir={elegir}
            nuevo={nuevo}
            vacio={vacio}
            pie={pie}
            accionCabecera={
              <Tooltip content="Plegar el historial" side="right">
                <IconButton label="Plegar el historial" size="sm" onClick={alternar} className="cursor-pointer">
                  <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden />
                </IconButton>
              </Tooltip>
            }
          />
        </aside>
      )}

      {/* Teléfono: una barra fina sobre la conversación abre el historial como
          cajón. Va en el flujo, no flotando, para no tapar el campo de escribir. */}
      <button
        type="button"
        onClick={() => setMovilAbierto(true)}
        className="flex w-full shrink-0 cursor-pointer items-center gap-2 border-b-2 border-[var(--border-subtle)] bg-nav px-4 py-2 text-sm font-semibold text-fg transition-colors active:bg-raised md:hidden"
      >
        <History size={16} strokeWidth={2} className="text-primary" aria-hidden />
        {titulo}
        {cuenta > 0 ? <span className="tnum text-fg-muted">{cuenta}</span> : null}
        <span className="ml-auto text-xs font-medium text-fg-muted">Ver historial</span>
      </button>
      {movilAbierto ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={titulo}>
          <button
            type="button"
            aria-label="Cerrar el historial"
            className="strappy-fade-in absolute inset-0 cursor-default bg-[var(--scrim)]"
            onClick={() => setMovilAbierto(false)}
          />
          <div className="strappy-menu-izquierda absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-nav shadow-e3">
            <Contenido
              titulo={titulo}
              items={items}
              activoId={activoId ?? null}
              onElegir={elegir}
              nuevo={nuevo}
              vacio={vacio}
              pie={pie}
              accionCabecera={
                <IconButton label="Cerrar el historial" size="sm" onClick={() => setMovilAbierto(false)}>
                  <X size={17} strokeWidth={1.75} aria-hidden />
                </IconButton>
              }
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Contenido({
  titulo,
  items,
  activoId,
  onElegir,
  nuevo,
  vacio,
  pie,
  accionCabecera,
}: {
  titulo: string;
  items: readonly ItemHistorial[];
  activoId: string | null;
  onElegir: (id: string) => void;
  nuevo: AccionNuevo | undefined;
  vacio: string;
  pie: React.ReactNode;
  accionCabecera: React.ReactNode;
}) {
  const [busqueda, setBusqueda] = React.useState("");
  const consulta = sinTildes(busqueda.trim());

  const grupos = React.useMemo(() => {
    const filtrados = [...items]
      .filter((item) => consulta.length === 0 || sinTildes(item.titulo).includes(consulta))
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    const porGrupo = new Map<GrupoFecha, ItemHistorial[]>();
    for (const item of filtrados) {
      const grupo = grupoDeFecha(item.fecha);
      porGrupo.set(grupo, [...(porGrupo.get(grupo) ?? []), item]);
    }
    return ORDEN_GRUPOS.flatMap((grupo) => {
      const lista = porGrupo.get(grupo);
      return lista ? [{ grupo, lista }] : [];
    });
  }, [items, consulta]);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
          <History size={16} strokeWidth={2} aria-hidden className="text-primary-fg" />
          {titulo}
          <span className="tnum rounded-full bg-hover px-2 py-0.5 text-2xs font-medium text-fg-muted">
            {items.length}
          </span>
        </h2>
        {accionCabecera}
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {nuevo ? <BotonNuevo nuevo={nuevo} /> : null}
        {items.length > 4 ? (
          <label className="relative flex items-center">
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3 text-fg-muted" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar en el historial"
              aria-label="Buscar en el historial"
              className="h-9 w-full rounded-md border-2 border-border bg-inset pl-9 pr-3 text-sm text-fg shadow-hundido placeholder:text-fg-muted focus-visible:border-[color-mix(in_oklab,var(--brand),transparent_40%)] focus-visible:outline-none"
            />
          </label>
        ) : null}
      </div>

      <nav aria-label={titulo} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {grupos.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-fg-muted">
            {consulta ? "Nada coincide con esa búsqueda." : vacio}
          </p>
        ) : (
          grupos.map(({ grupo, lista }) => (
            <section key={grupo} className="flex flex-col gap-1 pb-3">
              <h3 className="px-3 pb-0.5 pt-1 font-sans text-2xs font-semibold uppercase tracking-wide text-fg-muted">
                {grupo}
              </h3>
              {lista.map((item) => (
                <ElementoHistorial
                  key={item.id}
                  item={item}
                  activo={item.id === activoId}
                  onElegir={onElegir}
                />
              ))}
            </section>
          ))
        )}
      </nav>

      {pie ? <div className="shrink-0 border-t-2 border-[var(--border-subtle)] p-2">{pie}</div> : null}
    </>
  );
}

function ElementoHistorial({
  item,
  activo,
  onElegir,
}: {
  item: ItemHistorial;
  activo: boolean;
  onElegir: (id: string) => void;
}) {
  const clases = cn(
    "flex w-full cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-left",
    "transition-[background-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]",
    "active:scale-[0.98] motion-reduce:active:scale-100",
    activo ? "bg-selected shadow-e1" : "hover:bg-hover",
  );
  const contenido = (
    <>
      <span className="flex items-center gap-2">
        {item.estado?.vivo ? (
          <span aria-hidden className="relative grid size-2 shrink-0 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/50 motion-reduce:animate-none" />
            <span className="relative size-2 rounded-full bg-primary" />
          </span>
        ) : null}
        <span className={cn("truncate text-sm", activo ? "font-semibold text-fg" : "font-medium text-fg-secondary")}>
          {item.titulo}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2">
        {item.estado ? <Badge tone={item.estado.tono}>{item.estado.texto}</Badge> : <span />}
        <time suppressHydrationWarning dateTime={item.fecha} className="tnum shrink-0 text-2xs text-fg-muted">
          {haceRelativo(item.fecha)}
        </time>
      </span>
    </>
  );

  return item.href ? (
    <Link href={item.href} aria-current={activo ? "page" : undefined} className={clases}>
      {contenido}
    </Link>
  ) : (
    <button type="button" aria-current={activo ? "true" : undefined} onClick={() => onElegir(item.id)} className={clases}>
      {contenido}
    </button>
  );
}

function BotonNuevo({ nuevo, compacto = false }: { nuevo: AccionNuevo; compacto?: boolean }) {
  const clases = compacto
    ? "grid size-9 cursor-pointer place-items-center rounded-md bg-primary text-[var(--fg-on-brand)] shadow-marca transition-transform active:scale-90"
    : cn(
        "inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-[var(--fg-on-brand)] shadow-marca",
        "transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-0.5 active:translate-y-0 active:scale-x-[1.03] active:scale-y-[0.92]",
      );
  const icono = <Plus size={compacto ? 18 : 16} strokeWidth={2.25} aria-hidden />;
  const cuerpo = compacto ? icono : (
    <>
      {icono}
      {nuevo.etiqueta}
    </>
  );
  const boton = nuevo.href ? (
    <Link href={nuevo.href} aria-label={nuevo.etiqueta} className={clases}>
      {cuerpo}
    </Link>
  ) : (
    <button type="button" aria-label={nuevo.etiqueta} onClick={nuevo.onClick} className={clases}>
      {cuerpo}
    </button>
  );
  return compacto ? (
    <Tooltip content={nuevo.etiqueta} side="right">
      {boton}
    </Tooltip>
  ) : (
    boton
  );
}
