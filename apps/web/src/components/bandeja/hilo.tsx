"use client";

/**
 * El hilo.
 *
 * Aquí vive la tesis del producto: EL COLOR DICE QUIÉN HABLA. Índigo la IA,
 * fucsia tu equipo, neutro elevado el cliente, neutro medio el sistema. Ninguna
 * burbuja elige su color por otra vía que `quien`.
 *
 * El barrido de 300 ms al tomar el control no es un adorno: cuando pasas a
 * mandar tú, todo lo que dice «esto lo lleva la IA» cambia de índigo a fucsia a
 * la vez, y esa transición ES la confirmación de que el cambio ocurrió. Un
 * cambio instantáneo se confunde con un fallo de pintado.
 */
import * as React from "react";
import { AlertCircle, Bookmark, Check, CheckCheck, Clock, StickyNote } from "lucide-react";
import { Avatar, EmptyState, IconButton, Kbd, Skeleton, Tooltip, cn } from "@strappy/ui";
import type { ElementoHilo, Hilo as HiloDatos } from "@/lib/bandeja/tipos";
import { claveDeDia, fechaCompleta, hora, tituloDeDia } from "./formato";

export function Hilo({
  hilo,
  cargando,
  alGuardarRespuesta,
}: {
  hilo: HiloDatos | null;
  cargando: boolean;
  alGuardarRespuesta: (texto: string) => void;
}) {
  const contenedor = React.useRef<HTMLDivElement>(null);
  const ultimoId = hilo?.elementos[hilo.elementos.length - 1]?.id ?? null;

  // Al fondo con cada mensaje nuevo y al cambiar de conversación: quien atiende
  // quiere ver lo último, no dónde se quedó el scroll de otro hilo.
  React.useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    nodo.scrollTop = nodo.scrollHeight;
  }, [ultimoId, hilo?.conversacion.id]);

  if (cargando && !hilo) return <EsqueletoHilo />;
  if (!hilo) return null;

  // Se decide antes de pintar en qué posiciones cambia el día: mutar una
  // variable dentro del `map` es exactamente lo que rompe con render
  // concurrente, donde el mismo árbol puede pintarse dos veces.
  const abreDia = marcarCambiosDeDia(hilo.elementos);

  return (
    <div
      ref={contenedor}
      data-mando={hilo.conversacion.mando}
      className="group/hilo min-h-0 flex-1 overflow-y-auto px-4 py-4"
    >
      <div
        className="mx-auto flex max-w-[62rem] flex-col gap-2"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensajes de la conversación"
      >
        {hilo.elementos.map((elemento, posicion) => {
          return (
            <React.Fragment key={elemento.id}>
              {abreDia[posicion] && <SeparadorDeDia fecha={elemento.fecha} />}
              <Elemento
                elemento={elemento}
                posicion={posicion}
                agente={hilo.conversacion.agente?.nombre ?? "La IA"}
                contacto={hilo.contacto.nombre}
                alGuardarRespuesta={alGuardarRespuesta}
              />
            </React.Fragment>
          );
        })}
        {hilo.elementos.length === 0 && (
          <p className="py-10 text-center text-base text-fg-muted">
            Todavía no hay mensajes en esta conversación.
          </p>
        )}
      </div>
    </div>
  );
}

/** Qué elementos abren un día nuevo. Función pura, sin estado escondido. */
function marcarCambiosDeDia(elementos: readonly ElementoHilo[]): boolean[] {
  let anterior = "";
  return elementos.map((elemento) => {
    const dia = claveDeDia(elemento.fecha);
    const cambia = dia !== anterior;
    anterior = dia;
    return cambia;
  });
}

function SeparadorDeDia({ fecha }: { fecha: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-[var(--border-subtle)]" />
      <span className="text-xs font-medium text-fg-muted">{tituloDeDia(fecha)}</span>
      <span className="h-px flex-1 bg-[var(--border-subtle)]" />
    </div>
  );
}

function Elemento({
  elemento,
  posicion,
  agente,
  contacto,
  alGuardarRespuesta,
}: {
  elemento: ElementoHilo;
  posicion: number;
  agente: string;
  contacto: string;
  alGuardarRespuesta: (texto: string) => void;
}) {
  if (elemento.clase === "evento") return <BurbujaSistema elemento={elemento} posicion={posicion} />;
  if (elemento.clase === "nota") return <BurbujaNota elemento={elemento} />;

  const propio = elemento.quien !== "cliente";
  const autor =
    elemento.quien === "ia" ? agente : elemento.quien === "humano" ? (elemento.autor ?? "Tu equipo") : contacto;

  return (
    <div className={cn("flex w-full gap-2", propio ? "justify-end" : "justify-start")}>
      {!propio && <Avatar size="sm" tone="cliente" name={contacto} className="mt-5" />}
      <div className={cn("flex min-w-0 max-w-[min(42rem,78%)] flex-col gap-1", propio && "items-end")}>
        <span className="px-1 text-2xs font-medium uppercase tracking-wide text-fg-muted">
          {elemento.quien === "ia" && <span className="text-primary-fg">IA · {autor}</span>}
          {elemento.quien === "humano" && <span className="text-human-fg">{autor}</span>}
          {elemento.quien === "cliente" && <span>{autor}</span>}
        </span>

        <div className={cn("group/burbuja flex items-end gap-1", propio && "flex-row-reverse")}>
          <div
            data-quien={elemento.quien}
            className={cn(
              "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-md",
              "transition-colors duration-[var(--dur-slow)] motion-reduce:transition-none",
              elemento.quien === "cliente" && "rounded-bl-md border border-border bg-raised text-fg",
              elemento.quien === "ia" &&
                "rounded-br-md bg-primary-soft text-fg ring-1 ring-[color-mix(in_oklab,var(--brand),transparent_70%)]",
              elemento.quien === "humano" &&
                "rounded-br-md bg-human-soft text-fg ring-1 ring-[color-mix(in_oklab,var(--human),transparent_60%)]",
            )}
          >
            {elemento.texto}
          </div>

          {propio && elemento.tipo === "text" && (
            <Tooltip content="Guardar como respuesta rápida">
              <IconButton
                label="Guardar como respuesta rápida"
                size="sm"
                variant="ghost"
                className="opacity-0 transition-opacity group-hover/burbuja:opacity-100 focus-visible:opacity-100"
                onClick={() => alGuardarRespuesta(elemento.texto)}
              >
                <Bookmark size={15} strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
          )}
        </div>

        <span className="flex items-center gap-1 px-1 text-2xs text-fg-muted" title={fechaCompleta(elemento.fecha)}>
          <span className="tnum">{hora(elemento.fecha)}</span>
          {propio && <Acuse estado={elemento.estado} error={elemento.error} />}
        </span>
      </div>
    </div>
  );
}

/** El estado real del envío. Nunca se finge un «entregado» que no ocurrió. */
function Acuse({ estado, error }: { estado: string; error: string | null }) {
  if (estado === "failed") {
    return (
      <span className="flex items-center gap-1 text-danger-fg" title={error ?? "No se pudo entregar"}>
        <AlertCircle size={12} strokeWidth={2} aria-hidden />
        No se envió
      </span>
    );
  }
  if (estado === "pending") {
    return (
      <span className="flex items-center gap-1" title="Pendiente de envío al canal">
        <Clock size={12} strokeWidth={2} aria-hidden />
        Enviando
      </span>
    );
  }
  if (estado === "read") {
    return (
      <span className="text-info-fg" title="Leído">
        <CheckCheck size={13} strokeWidth={2} aria-hidden />
        <span className="sr-only">Leído</span>
      </span>
    );
  }
  if (estado === "delivered") {
    return (
      <span title="Entregado">
        <CheckCheck size={13} strokeWidth={2} aria-hidden />
        <span className="sr-only">Entregado</span>
      </span>
    );
  }
  return (
    <span title="Enviado">
      <Check size={13} strokeWidth={2} aria-hidden />
      <span className="sr-only">Enviado</span>
    </span>
  );
}

/**
 * Las burbujas del sistema son las que hacen el barrido.
 *
 * Cuando el mando pasa a ser tuyo, el contenedor cambia `data-mando` y estas
 * pastillas viajan de índigo a fucsia en 300 ms, con un retraso escalonado que
 * hace que el cambio recorra el hilo de arriba abajo en lugar de parpadear.
 */
function BurbujaSistema({ elemento, posicion }: { elemento: ElementoHilo; posicion: number }) {
  return (
    <div className="flex justify-center py-1">
      <span
        style={{ transitionDelay: `${Math.min(posicion, 10) * 22}ms` }}
        className={cn(
          "rounded-full border px-3 py-1 text-xs",
          "transition-colors duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none",
          "border-border bg-hover text-fg-muted",
          elemento.clase === "evento" &&
            elemento.quien === "ia" &&
            "border-[color-mix(in_oklab,var(--brand),transparent_65%)] bg-primary-soft text-primary-fg",
          "group-data-[mando=tuyo]/hilo:border-[color-mix(in_oklab,var(--human),transparent_60%)]",
          "group-data-[mando=tuyo]/hilo:bg-human-soft group-data-[mando=tuyo]/hilo:text-human-fg",
        )}
      >
        {elemento.texto}
      </span>
    </div>
  );
}

/** Nota interna: ámbar, y lo dice con letras además del color. */
function BurbujaNota({ elemento }: { elemento: Extract<ElementoHilo, { clase: "nota" }> }) {
  return (
    <div className="flex justify-center py-1">
      <div className="w-full max-w-[min(42rem,78%)] rounded-xl border border-[color-mix(in_oklab,var(--warning),transparent_55%)] bg-[var(--warning-soft)] px-3.5 py-2">
        <p className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--warning-fg)]">
          <StickyNote size={12} strokeWidth={2} aria-hidden />
          Nota interna · solo la ve tu equipo
        </p>
        <p className="whitespace-pre-wrap break-words text-md text-fg">{elemento.texto}</p>
        <p className="mt-1 text-2xs text-fg-muted">
          {elemento.autor ?? "Alguien del equipo"} · <span className="tnum">{hora(elemento.fecha)}</span>
        </p>
      </div>
    </div>
  );
}

function EsqueletoHilo() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-6">
      {[0, 1, 2, 3, 4].map((n) => (
        <div key={n} className={cn("flex", n % 2 ? "justify-end" : "justify-start")}>
          <Skeleton className="h-12 w-[min(28rem,60%)] rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

/**
 * El vacío cuando no hay hilo abierto.
 *
 * Un hueco gris sería espacio desperdiciado en la pantalla que más se mira del
 * producto: se aprovecha para enseñar los atajos, que es lo que convierte a
 * quien atiende diez conversaciones al día en alguien que atiende cincuenta.
 */
export function SinHiloSeleccionado() {
  const atajos: readonly { teclas: React.ReactNode; que: string }[] = [
    { teclas: <><Kbd>J</Kbd> <Kbd>K</Kbd></>, que: "Moverte por la lista" },
    { teclas: <><Kbd>⌘</Kbd>+<Kbd>.</Kbd></>, que: "Tomar o devolver el control" },
    { teclas: <Kbd>/</Kbd>, que: "Buscar, o insertar una respuesta rápida" },
    { teclas: <><Kbd>⌘</Kbd>+<Kbd>L</Kbd></>, que: "Etiquetar la conversación" },
    { teclas: <Kbd>Esc</Kbd>, que: "Cerrar lo que esté abierto" },
  ];

  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6">
      <div className="flex max-w-md flex-col items-center gap-5">
        <EmptyState
          variant="sin-resultados"
          size="sm"
          title="Elige una conversación"
          description="Aquí verás el hilo completo y sabrás de un vistazo si contestó la IA o contestó tu equipo."
        />
        <dl className="w-full rounded-xl border border-border bg-raised p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
            Atajos de teclado
          </p>
          {atajos.map((atajo) => (
            <div
              key={atajo.que}
              className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] py-1.5 first-of-type:border-t-0"
            >
              <dt className="text-base text-fg-secondary">{atajo.que}</dt>
              <dd className="flex shrink-0 items-center gap-1">{atajo.teclas}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
