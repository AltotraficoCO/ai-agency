"use client";

/**
 * La lista de conversaciones.
 *
 * Cada fila tiene que contestar cuatro preguntas en menos de un segundo: quién
 * escribe, qué dijo, quién lo está atendiendo y si lleva demasiado esperando.
 * Todo lo demás sobra, y por eso no está.
 *
 * Quién atiende se dice con icono y palabra, no solo con el color de la barra:
 * «IA», «Tú», «En pausa». El color ayuda a escanear; la palabra es la que no
 * falla con daltonismo, brillo bajo o una captura en blanco y negro.
 *
 * La hora en rojo con reloj no es decoración: es el acuerdo de servicio. Una
 * conversación en la que el último en hablar fue el cliente y lleva más del
 * límite sin respuesta se marca y se puede agrupar con el chip «Urgentes».
 */
import * as React from "react";
import { AlarmClock, Bot, Clock, Filter, Pause, Search, Sparkles, User, UserCheck, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  FilterChip,
  IconButton,
  Input,
  Skeleton,
  cn,
} from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import type { Catalogos, ConversacionResumen, Filtros, Pestana } from "@/lib/bandeja/tipos";
import { filtrosActivos } from "@/lib/bandeja/tipos";
import type { Contadores } from "./api";
import { esperaLegible, horaDeLista } from "./formato";
import { PanelFiltros } from "./filtros";

const PESTANAS: readonly { valor: Pestana; etiqueta: string; clave: keyof Contadores; ayuda: string }[] = [
  { valor: "todas", etiqueta: "Todas", clave: "todas", ayuda: "Todas las conversaciones abiertas" },
  { valor: "mias", etiqueta: "Mías", clave: "mias", ayuda: "Las que tienes asignadas tú" },
  { valor: "sin-asignar", etiqueta: "Sin asignar", clave: "sin-asignar", ayuda: "Nadie del equipo se ha hecho cargo" },
  { valor: "sin-leer", etiqueta: "Sin leer", clave: "sin-leer", ayuda: "Tienen mensajes que nadie ha abierto" },
];

/** Lo que devuelve «Limpiar»: la bandeja tal y como se abre. */
const SIN_FILTROS: Partial<Filtros> = {
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
};

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
      className="flex w-full shrink-0 flex-col border-r border-border bg-page lg:w-[360px]"
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-3 pt-3">
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
            placeholder="Buscar por nombre, teléfono o mensaje"
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

        {/* Pestañas segmentadas: la cifra arriba se lee de un vistazo, la
            palabra abajo explica qué cuenta. Cuatro cabían justas como
            subrayado y partían palabras; así no. */}
        <div role="tablist" aria-label="Qué conversaciones ver" className="grid grid-cols-4 gap-1 rounded-lg bg-inset p-1">
          {PESTANAS.map((pestana) => {
            const activa = filtros.pestana === pestana.valor;
            const cuantas = contadores[pestana.clave];
            return (
              <button
                key={pestana.valor}
                type="button"
                role="tab"
                aria-selected={activa}
                title={pestana.ayuda}
                onClick={() => cambiarFiltros({ pestana: pestana.valor })}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-0.5 rounded-md px-1 py-1.5",
                  "transition-colors duration-[var(--dur-fast)]",
                  activa
                    ? "bg-raised text-fg shadow-e1 ring-1 ring-border"
                    : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                <span
                  className={cn(
                    "tnum text-base font-semibold leading-none",
                    pestana.valor === "sin-leer" && cuantas > 0 && "text-primary-fg",
                  )}
                >
                  {cuantas}
                </span>
                <span className="whitespace-nowrap text-2xs font-medium">{pestana.etiqueta}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-2.5">
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
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => cambiarFiltros(SIN_FILTROS)}>
            <X size={14} strokeWidth={2} aria-hidden />
            Limpiar
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
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
                    <Button size="sm" variant="secondary" onClick={() => cambiarFiltros(SIN_FILTROS)}>
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
                  <EnlaceBoton href="/ajustes/canales" size="sm">
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

        <ul className="flex flex-col gap-0.5 px-2">
          {conversaciones.map((conversacion, posicion) => (
            <li
              key={conversacion.id}
              className="strappy-slide-up"
              // Escalonado solo en las primeras: pasado el pliegue nadie lo ve y
              // haría esperar a quien baja rápido.
              style={{ animationDelay: `${Math.min(posicion, 10) * 25}ms` }}
            >
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
  const sinLeer = conversacion.sinLeer > 0;
  const prefijo = ultimo?.quien === "ia" ? "IA: " : ultimo?.quien === "humano" ? "Equipo: " : "";

  return (
    <button
      type="button"
      onClick={alSeleccionar}
      aria-current={activa ? "true" : undefined}
      data-conversacion={conversacion.id}
      className={cn(
        "group relative flex w-full cursor-pointer gap-2.5 overflow-hidden rounded-lg px-3 py-2.5 text-left",
        "transition-colors duration-[var(--dur-fast)]",
        activa
          ? "bg-selected ring-1 ring-[color-mix(in_oklab,var(--brand),transparent_60%)]"
          : "hover:bg-hover",
      )}
    >
      {/* La barra de la izquierda dice quién manda sin ocupar una línea. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-0 w-[3px] rounded-r-full transition-colors duration-[var(--dur-base)]",
          mando === "ia" && "bg-[var(--brand)]",
          mando === "tuyo" && "bg-[var(--human)]",
          mando === "otro" && "bg-[var(--border-strong)]",
          mando === "pausado" && "bg-transparent",
        )}
      />

      <div className="relative mt-0.5 shrink-0">
        <Avatar
          name={conversacion.contacto.nombre}
          size="md"
          tone="cliente"
          {...(conversacion.contacto.avatar ? { src: conversacion.contacto.avatar } : {})}
        />
        {sinLeer && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--s-page)] bg-[var(--brand)]"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-base",
              sinLeer ? "font-semibold text-fg" : "font-medium text-fg",
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

        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", sinLeer ? "text-fg" : "text-fg-secondary")}>
            {prefijo && <span className="text-fg-muted">{prefijo}</span>}
            {ultimo?.texto || "Sin mensajes todavía"}
          </span>
          {sinLeer && (
            <span className="tnum grid min-w-5 shrink-0 place-items-center rounded-full bg-[var(--brand)] px-1.5 text-2xs font-semibold text-[var(--fg-on-brand)]">
              {conversacion.sinLeer}
              <span className="sr-only"> sin leer</span>
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <QuienAtiende mando={mando} otro={conversacion.asignado?.nombre ?? null} />
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
              className="inline-flex min-w-0 items-center gap-1 truncate rounded-full px-1.5 py-px text-2xs text-fg-secondary"
              style={{ backgroundColor: `color-mix(in oklab, ${etiqueta.color}, transparent 86%)` }}
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: etiqueta.color }} />
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
      </div>
    </button>
  );
}

/** Quién contesta ahora mismo, en una palabra y con su icono. */
function QuienAtiende({ mando, otro }: { mando: ConversacionResumen["mando"]; otro: string | null }) {
  const comun = "inline-flex shrink-0 items-center gap-1 text-2xs font-medium";
  if (mando === "ia") {
    return (
      <span className={cn(comun, "text-primary-fg")}>
        <Bot size={12} strokeWidth={2} aria-hidden />
        IA
      </span>
    );
  }
  if (mando === "tuyo") {
    return (
      <span className={cn(comun, "text-human-fg")}>
        <UserCheck size={12} strokeWidth={2} aria-hidden />
        Tú
      </span>
    );
  }
  if (mando === "otro") {
    return (
      <span className={cn(comun, "max-w-[8rem] truncate text-fg-secondary")}>
        <User size={12} strokeWidth={2} aria-hidden />
        {otro ?? "Otra persona"}
      </span>
    );
  }
  return (
    <span className={cn(comun, "text-fg-muted")}>
      <Pause size={12} strokeWidth={2} aria-hidden />
      En pausa
    </span>
  );
}

/** Ocho esqueletos de la altura real de una fila, para que no salte. */
function Esqueletos() {
  return (
    <ul aria-hidden className="flex flex-col gap-0.5 px-2">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
        <li key={n} className="flex h-[82px] items-center gap-2.5 rounded-lg px-3">
          <Skeleton shape="circulo" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton shape="linea" className="w-1/2" />
            <Skeleton shape="linea" className="w-4/5" />
            <Skeleton shape="linea" className="w-1/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}
