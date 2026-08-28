"use client";

/**
 * La lista de conversaciones.
 *
 * Cada fila tiene que contestar cuatro preguntas en menos de un segundo: quién
 * escribe, qué dijo, quién lo está atendiendo y si lleva demasiado esperando.
 * Todo lo demás sobra, y por eso no está.
 *
 * La hora en rojo con reloj no es decoración: es el acuerdo de servicio. Una
 * conversación en la que el último en hablar fue el cliente y lleva más del
 * límite sin respuesta se marca y se puede agrupar con el chip «Urgentes».
 */
import * as React from "react";
import { AlarmClock, Clock, Filter, Search, Sparkles, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  FilterChip,
  IconButton,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import type { Catalogos, ConversacionResumen, Filtros, Pestana } from "@/lib/bandeja/tipos";
import { filtrosActivos } from "@/lib/bandeja/tipos";
import type { Contadores } from "./api";
import { esperaLegible, horaDeLista } from "./formato";
import { PanelFiltros } from "./filtros";

const PESTANAS: readonly { valor: Pestana; etiqueta: string; clave: keyof Contadores }[] = [
  { valor: "todas", etiqueta: "Todas", clave: "todas" },
  { valor: "mias", etiqueta: "Mías", clave: "mias" },
  { valor: "sin-asignar", etiqueta: "Sin asignar", clave: "sin-asignar" },
  { valor: "sin-leer", etiqueta: "Sin leer", clave: "sin-leer" },
];

export function Lista({
  conversaciones,
  contadores,
  filtros,
  cambiarFiltros,
  seleccionada,
  alSeleccionar,
  cargando,
  catalogos,
  refBusqueda,
  alSembrar,
  sembrando,
}: {
  conversaciones: readonly ConversacionResumen[];
  contadores: Contadores;
  filtros: Filtros;
  cambiarFiltros: (cambio: Partial<Filtros>) => void;
  seleccionada: string | null;
  alSeleccionar: (id: string) => void;
  cargando: boolean;
  catalogos: Catalogos;
  refBusqueda: React.RefObject<HTMLInputElement | null>;
  alSembrar: (() => void) | null;
  sembrando: boolean;
}) {
  const [abrirFiltros, setAbrirFiltros] = React.useState(false);
  const activos = filtrosActivos(filtros);
  const hayFiltro = activos > 0 || filtros.busqueda.trim().length > 0 || filtros.pestana !== "todas";

  return (
    <section
      aria-label="Conversaciones"
      className="flex w-full shrink-0 flex-col border-r border-border bg-page lg:w-[340px]"
    >
      <div className="shrink-0 px-3 pt-3">
        <div className="relative">
          <Search
            size={15}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <Input
            ref={refBusqueda}
            value={filtros.busqueda}
            onChange={(evento) => cambiarFiltros({ busqueda: evento.target.value })}
            placeholder="Buscar por nombre, teléfono o texto"
            aria-label="Buscar conversaciones"
            className="pl-9"
          />
          {filtros.busqueda && (
            <IconButton
              label="Limpiar la búsqueda"
              size="sm"
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => cambiarFiltros({ busqueda: "" })}
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </IconButton>
          )}
        </div>
      </div>

      <Tabs
        value={filtros.pestana}
        onValueChange={(valor) => cambiarFiltros({ pestana: valor as Pestana })}
        className="shrink-0 px-3 pt-2"
      >
        <TabsList className="gap-0">
          {PESTANAS.map((pestana) => (
            <TabsTrigger
              key={pestana.valor}
              value={pestana.valor}
              count={contadores[pestana.clave]}
              // 340 px dan justo para las cuatro pestañas en una línea, y solo
              // si no parten palabras ni se separan de más.
              className="whitespace-nowrap px-1.5 text-sm"
            >
              {pestana.etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-2">
        <FilterChip
          active={filtros.soloUrgentes}
          count={contadores.urgentes}
          onClick={() => cambiarFiltros({ soloUrgentes: !filtros.soloUrgentes })}
        >
          <AlarmClock size={14} strokeWidth={1.75} aria-hidden />
          Urgentes
        </FilterChip>
        <FilterChip active={activos > 0} hasMenu onClick={() => setAbrirFiltros(true)}>
          <Filter size={14} strokeWidth={1.75} aria-hidden />
          Filtros
          {activos > 0 && <span className="tnum">{activos}</span>}
        </FilterChip>
        {hayFiltro && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              cambiarFiltros({
                pestana: "todas",
                busqueda: "",
                estado: "abiertas",
                canalId: null,
                asignadoId: null,
                agenteId: null,
                etiquetaId: null,
                desde: null,
                hasta: null,
                soloUrgentes: false,
              })
            }
          >
            Limpiar
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando && conversaciones.length === 0 && <Esqueletos />}

        {!cargando && conversaciones.length === 0 && (
          <div className="px-4 py-6">
            {catalogos.hayCanal || hayFiltro ? (
              <EmptyState
                variant="sin-resultados"
                size="sm"
                title="Nada por aquí"
                description="Ninguna conversación coincide con lo que estás buscando. Prueba a quitar algún filtro."
                action={
                  hayFiltro ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        cambiarFiltros({
                          pestana: "todas",
                          busqueda: "",
                          estado: "abiertas",
                          etiquetaId: null,
                          asignadoId: null,
                          agenteId: null,
                          canalId: null,
                          soloUrgentes: false,
                        })
                      }
                    >
                      Quitar los filtros
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                variant="primera-vez"
                size="sm"
                title="Conecta WhatsApp para empezar"
                description="En cuanto tu número esté conectado, cada conversación aparecerá aquí y sabrás si contestó la IA o contestaste tú."
                action={
                  <EnlaceBoton href="/canales" size="sm">
                    Conectar WhatsApp
                  </EnlaceBoton>
                }
                secondaryAction={
                  alSembrar ? (
                    <Button size="sm" variant="ghost" onClick={alSembrar} loading={sembrando}>
                      <Sparkles size={15} strokeWidth={1.75} aria-hidden />
                      Sembrar ejemplos
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}

        <ul>
          {conversaciones.map((conversacion) => (
            <li key={conversacion.id}>
              <Fila
                conversacion={conversacion}
                activa={conversacion.id === seleccionada}
                alSeleccionar={() => alSeleccionar(conversacion.id)}
              />
            </li>
          ))}
        </ul>
      </div>

      <PanelFiltros
        abierto={abrirFiltros}
        alCerrar={() => setAbrirFiltros(false)}
        filtros={filtros}
        cambiarFiltros={cambiarFiltros}
        catalogos={catalogos}
      />
    </section>
  );
}

function Fila({
  conversacion,
  activa,
  alSeleccionar,
}: {
  conversacion: ConversacionResumen;
  activa: boolean;
  alSeleccionar: () => void;
}) {
  const { ultimo, mando } = conversacion;

  return (
    <button
      type="button"
      onClick={alSeleccionar}
      aria-current={activa ? "true" : undefined}
      data-conversacion={conversacion.id}
      className={cn(
        "relative flex w-full gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5 text-left",
        "transition-colors duration-[var(--dur-instant)]",
        activa ? "bg-selected" : "hover:bg-hover",
      )}
    >
      {/* La barra de la izquierda dice quién manda sin ocupar una línea. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-[3px] transition-colors duration-[var(--dur-base)]",
          mando === "ia" && "bg-[var(--brand)]",
          mando === "tuyo" && "bg-[var(--human)]",
          mando === "otro" && "bg-[var(--border-strong)]",
          mando === "pausado" && "bg-transparent",
        )}
      />

      <Avatar
        name={conversacion.contacto.nombre}
        size="md"
        tone="cliente"
        {...(conversacion.contacto.avatar ? { src: conversacion.contacto.avatar } : {})}
        className="mt-0.5"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-base",
              conversacion.sinLeer > 0 ? "font-semibold text-fg" : "font-medium text-fg",
            )}
          >
            {conversacion.contacto.nombre}
          </span>
          <span
            className={cn(
              "tnum flex shrink-0 items-center gap-1 text-2xs",
              conversacion.urgente ? "font-medium text-danger-fg" : "text-fg-muted",
            )}
            title={
              conversacion.urgente && conversacion.ultimoEntrante
                ? esperaLegible(conversacion.ultimoEntrante)
                : undefined
            }
          >
            {conversacion.urgente && <Clock size={11} strokeWidth={2.25} aria-hidden />}
            {horaDeLista(conversacion.ultimaFecha)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              ultimo?.quien === "ia" && "bg-[var(--brand)]",
              ultimo?.quien === "humano" && "bg-[var(--human)]",
              ultimo?.quien === "cliente" && "bg-[var(--border-strong)]",
              ultimo?.quien === "sistema" && "bg-transparent",
            )}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              conversacion.sinLeer > 0 ? "text-fg" : "text-fg-secondary",
            )}
          >
            {ultimo?.texto || "Sin mensajes todavía"}
          </span>
          {conversacion.sinLeer > 0 && (
            <span className="tnum grid min-w-5 shrink-0 place-items-center rounded-full bg-[var(--brand)] px-1.5 text-2xs font-semibold text-[var(--fg-on-brand)]">
              {conversacion.sinLeer}
            </span>
          )}
        </div>

        {(conversacion.etiquetas.length > 0 ||
          conversacion.asignado ||
          conversacion.estado !== "open") && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {conversacion.estado === "snoozed" && (
              <Badge tone="aviso">
                <Clock size={11} strokeWidth={2} aria-hidden />
                Pospuesta
              </Badge>
            )}
            {conversacion.estado === "closed" && <Badge tone="neutral">Cerrada</Badge>}
            {conversacion.etiquetas.slice(0, 2).map((etiqueta) => (
              <span
                key={etiqueta.id}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-2xs text-fg-secondary"
                style={{
                  borderColor: `color-mix(in oklab, ${etiqueta.color}, transparent 55%)`,
                  backgroundColor: `color-mix(in oklab, ${etiqueta.color}, transparent 88%)`,
                }}
              >
                <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: etiqueta.color }} />
                {etiqueta.nombre}
              </span>
            ))}
            {conversacion.etiquetas.length > 2 && (
              <span className="text-2xs text-fg-muted">+{conversacion.etiquetas.length - 2}</span>
            )}
            {conversacion.asignado && (
              <Avatar
                size="xs"
                tone="humano"
                name={conversacion.asignado.nombre}
                className="ml-auto"
                {...(conversacion.asignado.avatar ? { src: conversacion.asignado.avatar } : {})}
              />
            )}
          </div>
        )}
      </div>
    </button>
  );
}

/** Ocho esqueletos de 72 px: la altura real de una fila, para que no salte. */
function Esqueletos() {
  return (
    <ul aria-hidden>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
        <li key={n} className="flex h-[72px] items-center gap-2.5 border-b border-[var(--border-subtle)] px-3">
          <Skeleton shape="circulo" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton shape="linea" className="w-1/2" />
            <Skeleton shape="linea" className="w-4/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}
