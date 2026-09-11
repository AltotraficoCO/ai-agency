"use client";

/**
 * El hilo.
 *
 * Aquí vive la tesis del producto: SE VE QUIÉN HABLA. La IA escribe en neutro
 * con borde y firma con su marca verde; tu equipo, en azul suave; el cliente,
 * en neutro elevado a la izquierda; el sistema, en píldoras centradas. Ninguna
 * burbuja elige su aspecto por otra vía que `quien`, y todas llevan además el
 * nombre de quien habla: el color solo nunca basta.
 *
 * El verde no va de fondo de burbuja: un párrafo verde sobre verde se lee mal,
 * y el acento pierde fuerza si lo tiñe todo.
 *
 * El barrido de 300 ms al tomar el control no es un adorno: cuando pasas a
 * mandar tú, las píldoras del sistema cambian al azul a la vez, y esa
 * transición ES la confirmación de que el cambio ocurrió.
 */
import * as React from "react";
import { AlertCircle, Bookmark, Check, CheckCheck, Clock, MessagesSquare, Sparkles, StickyNote } from "lucide-react";
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  IndicadorEscribiendo,
  Kbd,
  Skeleton,
  Tooltip,
  cn,
} from "@strappy/ui";
import type { ElementoHilo, Hilo as HiloDatos } from "@/lib/bandeja/tipos";
import { claveDeDia, fechaCompleta, hora, tituloDeDia } from "./formato";

/** Cuánto se sigue mostrando «escribiendo» tras el último mensaje del cliente. */
const ESPERA_RESPUESTA_IA_MS = 90_000;

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
  const ultimo = hilo?.elementos[hilo.elementos.length - 1] ?? null;
  const ultimoId = ultimo?.id ?? null;
  const [ahora, setAhora] = React.useState(() => Date.now());

  // El reloj avanza solo cada pocos segundos: basta para apagar el «escribiendo»
  // si la respuesta no llega, sin repintar el hilo a cada instante.
  React.useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);

  // No hay una señal de «la IA está escribiendo» en el servidor. Se deduce de
  // lo que sí es cierto: manda la IA, lo último lo dijo el cliente y hace muy
  // poco. Si pasa el margen sin respuesta, se apaga en vez de mentir.
  const iaPreparando =
    hilo !== null &&
    hilo.conversacion.mando === "ia" &&
    ultimo !== null &&
    ultimo.clase !== "evento" &&
    ultimo.clase !== "nota" &&
    ultimo.quien === "cliente" &&
    ahora - new Date(ultimo.fecha).getTime() < ESPERA_RESPUESTA_IA_MS;

  // Al fondo con cada mensaje nuevo y al cambiar de conversación: quien atiende
  // quiere ver lo último, no dónde se quedó el scroll de otro hilo.
  React.useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    nodo.scrollTop = nodo.scrollHeight;
  }, [ultimoId, hilo?.conversacion.id, iaPreparando]);

  if (cargando && !hilo) return <EsqueletoHilo />;
  if (!hilo) return null;

  // Se decide antes de pintar en qué posiciones cambia el día: mutar una
  // variable dentro del `map` es exactamente lo que rompe con render
  // concurrente, donde el mismo árbol puede pintarse dos veces.
  const abreDia = marcarCambiosDeDia(hilo.elementos);
  const total = hilo.elementos.length;
  const agente = hilo.conversacion.agente?.nombre ?? "La IA";

  return (
    <div
      ref={contenedor}
      data-mando={hilo.conversacion.mando}
      className="group/hilo min-h-0 flex-1 overflow-y-auto px-4 py-5"
    >
      <div
        className="mx-auto flex max-w-[58rem] flex-col gap-2.5"
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
                // Solo los últimos entran con movimiento: al abrir una
                // conversación larga, animar cien burbujas marea.
                reciente={total - posicion <= 6}
                agente={agente}
                contacto={hilo.contacto.nombre}
                alGuardarRespuesta={alGuardarRespuesta}
              />
            </React.Fragment>
          );
        })}

        {iaPreparando && (
          <div className="strappy-fade-in flex w-full items-end justify-end gap-2">
            <span className="rounded-2xl rounded-br-md border border-border bg-raised px-4 py-3">
              <IndicadorEscribiendo etiqueta={`${agente} está preparando la respuesta`} />
            </span>
            <Avatar size="sm" tone="ia" name={agente} />
          </div>
        )}

        {total === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <MessagesSquare size={28} strokeWidth={1.5} className="text-fg-muted" aria-hidden />
            <p className="text-base text-fg-secondary">Todavía no hay mensajes en esta conversación.</p>
          </div>
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
    <div className="my-2 flex justify-center" role="separator">
      <span className="rounded-full border border-border bg-overlay px-3 py-0.5 text-2xs font-medium text-fg-secondary">
        {tituloDeDia(fecha)}
      </span>
    </div>
  );
}

function Elemento({
  elemento,
  posicion,
  reciente,
  agente,
  contacto,
  alGuardarRespuesta,
}: {
  elemento: ElementoHilo;
  posicion: number;
  reciente: boolean;
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
    <div
      className={cn(
        "flex w-full items-end gap-2",
        propio ? "justify-end" : "justify-start",
        reciente && "strappy-slide-up",
      )}
    >
      {!propio && <Avatar size="sm" tone="cliente" name={contacto} className="mb-5 shrink-0" />}

      <div className={cn("flex min-w-0 max-w-[min(40rem,76%)] flex-col gap-1", propio && "items-end")}>
        <span className="flex items-center gap-1 px-1 text-2xs font-medium">
          {elemento.quien === "ia" && (
            <span className="inline-flex items-center gap-1 text-fg-secondary">
              <Sparkles size={11} strokeWidth={2} className="text-primary-fg" aria-hidden />
              {autor} · IA
            </span>
          )}
          {elemento.quien === "humano" && <span className="text-human-fg">{autor}</span>}
          {elemento.quien === "cliente" && <span className="text-fg-secondary">{autor}</span>}
        </span>

        <div className={cn("group/burbuja flex items-end gap-1", propio && "flex-row-reverse")}>
          <div
            data-quien={elemento.quien}
            className={cn(
              "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-md leading-relaxed",
              "transition-colors duration-[var(--dur-slow)] motion-reduce:transition-none",
              elemento.quien === "cliente" && "rounded-bl-md bg-overlay text-fg",
              elemento.quien === "ia" && "rounded-br-md border border-border bg-raised text-fg",
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

      {propio && (
        <Avatar
          size="sm"
          tone={elemento.quien === "ia" ? "ia" : "humano"}
          name={autor}
          className="mb-5 shrink-0"
        />
      )}
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
 * pastillas viajan al azul en 300 ms, con un retraso escalonado que hace que el
 * cambio recorra el hilo de arriba abajo en lugar de parpadear.
 */
function BurbujaSistema({ elemento, posicion }: { elemento: ElementoHilo; posicion: number }) {
  const deLaIa = elemento.clase === "evento" && elemento.quien === "ia";
  return (
    <div className="flex justify-center py-1">
      <span
        style={{ transitionDelay: `${Math.min(posicion, 10) * 22}ms` }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
          "transition-colors duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none",
          "border-border bg-inset text-fg-secondary",
          deLaIa && "border-[color-mix(in_oklab,var(--brand),transparent_70%)]",
          "group-data-[mando=tuyo]/hilo:border-[color-mix(in_oklab,var(--human),transparent_60%)]",
          "group-data-[mando=tuyo]/hilo:bg-human-soft group-data-[mando=tuyo]/hilo:text-human-fg",
        )}
      >
        {deLaIa && <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />}
        {elemento.texto}
      </span>
    </div>
  );
}

/** Nota interna: ámbar, y lo dice con letras además del color. */
function BurbujaNota({ elemento }: { elemento: Extract<ElementoHilo, { clase: "nota" }> }) {
  return (
    <div className="flex justify-center py-1">
      <div className="w-full max-w-[min(40rem,76%)] rounded-xl border border-[color-mix(in_oklab,var(--warning),transparent_55%)] bg-[var(--warning-soft)] px-3.5 py-2">
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
        <div key={n} className={cn("flex items-end gap-2", n % 2 ? "justify-end" : "justify-start")}>
          {n % 2 === 0 && <Skeleton shape="circulo" className="size-7" />}
          <Skeleton className="h-12 w-[min(28rem,60%)] rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

/**
 * El vacío cuando no hay hilo abierto.
 *
 * No es un hueco: ofrece el siguiente paso —abrir la conversación que más lo
 * necesita— y enseña los atajos, que es lo que convierte a quien atiende diez
 * conversaciones al día en alguien que atiende cincuenta.
 */
export function SinHiloSeleccionado({
  sinLeer,
  alAbrirSiguiente,
}: {
  sinLeer: number;
  /** Null cuando no hay ninguna conversación que abrir. */
  alAbrirSiguiente: (() => void) | null;
}) {
  const atajos: readonly { teclas: React.ReactNode; que: string }[] = [
    { teclas: <><Kbd>J</Kbd> <Kbd>K</Kbd></>, que: "Moverte por la lista" },
    { teclas: <><Kbd>⌘</Kbd>+<Kbd>.</Kbd></>, que: "Tomar o devolver el control" },
    { teclas: <Kbd>/</Kbd>, que: "Buscar o insertar respuesta rápida" },
    { teclas: <><Kbd>⌘</Kbd>+<Kbd>L</Kbd></>, que: "Etiquetar la conversación" },
  ];

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-8">
      <div className="strappy-slide-up flex w-full max-w-lg flex-col items-center gap-5">
        <EmptyState
          variant="sin-resultados"
          size="sm"
          title={sinLeer > 0 ? `Tienes ${sinLeer} ${sinLeer === 1 ? "conversación" : "conversaciones"} sin leer` : "Elige una conversación"}
          description="Ábrela para ver el hilo completo y saber de un vistazo si contestó la IA o alguien de tu equipo."
          action={
            alAbrirSiguiente ? (
              <Button onClick={alAbrirSiguiente}>
                <MessagesSquare size={16} strokeWidth={1.75} aria-hidden />
                {sinLeer > 0 ? "Abrir la primera sin leer" : "Abrir la más reciente"}
              </Button>
            ) : undefined
          }
        />
        <dl className="grid w-full gap-x-6 gap-y-1 rounded-xl border border-border bg-raised p-4 sm:grid-cols-2">
          <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-fg-muted sm:col-span-2">
            Atajos de teclado
          </p>
          {atajos.map((atajo) => (
            <div key={atajo.que} className="flex items-center justify-between gap-3 py-1">
              <dt className="text-sm text-fg-secondary">{atajo.que}</dt>
              <dd className="flex shrink-0 items-center gap-1">{atajo.teclas}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
