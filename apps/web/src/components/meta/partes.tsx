"use client";

/**
 * Los cuatro mensajes enriquecidos de Strap.
 *
 * Todos se pintan desde la SALIDA de una herramienta, tipada en
 * `lib/meta/tipos.ts`. No hay ni un `parse` de texto en este archivo, y esa es
 * la característica principal: el modelo no puede romper la interfaz
 * escribiendo mal un bloque, porque no escribe la interfaz.
 *
 *  1. Opciones — hasta cuatro botones apilados; al elegir, se colapsan a un
 *     chip con check. La respuesta ya está guardada; el chip lo demuestra.
 *  2. Checklist — pares clave-valor editables en línea. Editar NO rompe el
 *     flujo: guarda y se queda donde estaba.
 *  3. Tarjeta — borde izquierdo de éxito y muelle al entrar. Es el único
 *     momento de celebración del producto; si celebramos cada guardado, no
 *     celebra nada.
 *  4. Progreso — pasos en vivo que al terminar colapsan a una línea.
 */
import * as React from "react";
import { Check, ChevronDown, CircleAlert, ExternalLink, Loader2, Minus } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, cn } from "@strappy/ui";
import type {
  ItemChecklist,
  PreguntaRenderizada,
  SalidaAutojuego,
  SalidaChecklist,
  SalidaProgreso,
  SalidaTarjeta,
} from "@/lib/meta/tipos";

const CSS = `
@keyframes strap-muelle {
  from { opacity: 0; transform: scale(.96); }
  to   { opacity: 1; transform: scale(1); }
}
.strap-muelle { animation: strap-muelle 420ms var(--ease-spring) both; }
@media (prefers-reduced-motion: reduce) { .strap-muelle { animation: none; } }
`;

export function EstilosDeStrap() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}

// ---------------------------------------------------------------------------
// 1 · Opciones
// ---------------------------------------------------------------------------

export function BloqueOpciones({
  preguntas,
  respondidas,
  interactivo,
  onResponder,
}: {
  preguntas: readonly PreguntaRenderizada[];
  /** Lo ya guardado en el borrador, por clave. Es la fuente de verdad del chip. */
  respondidas: Readonly<Record<string, string>>;
  interactivo: boolean;
  onResponder: (clave: string, valores: string[], etiquetas: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {preguntas.map((pregunta) => (
        <Pregunta
          key={pregunta.clave}
          pregunta={pregunta}
          respuesta={respondidas[pregunta.clave] ?? ""}
          interactivo={interactivo}
          onResponder={onResponder}
        />
      ))}
    </div>
  );
}

function Pregunta({
  pregunta,
  respuesta,
  interactivo,
  onResponder,
}: {
  pregunta: PreguntaRenderizada;
  respuesta: string;
  interactivo: boolean;
  onResponder: (clave: string, valores: string[], etiquetas: string[]) => void;
}) {
  const [elegidas, setElegidas] = React.useState<string[]>([]);
  const [escrito, setEscrito] = React.useState("");

  if (respuesta.length > 0 || !interactivo) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-md text-fg">{pregunta.enunciado}</p>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-sm text-primary-fg">
          <Check size={14} strokeWidth={2.5} aria-hidden />
          {respuesta.length > 0 ? respuesta : "sin responder"}
        </span>
      </div>
    );
  }

  const etiquetaDe = (valor: string): string =>
    pregunta.opciones.find((o) => o.valor === valor)?.etiqueta ?? valor;

  const enviarEleccion = (valores: string[]): void => {
    if (valores.length === 0) return;
    onResponder(pregunta.clave, valores, valores.map(etiquetaDe));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-md text-fg">{pregunta.enunciado}</p>

      {pregunta.opciones.slice(0, 4).map((opcion) => {
        const marcada = elegidas.includes(opcion.valor);
        return (
          <button
            key={`${pregunta.clave}:${opcion.valor}`}
            type="button"
            onClick={() => {
              if (!pregunta.multiple) {
                enviarEleccion([opcion.valor]);
                return;
              }
              setElegidas((previas) =>
                previas.includes(opcion.valor)
                  ? previas.filter((v) => v !== opcion.valor)
                  : [...previas, opcion.valor],
              );
            }}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-[--dur-fast]",
              marcada
                ? "border-primary bg-primary-soft"
                : "border-border bg-raised hover:border-border-strong hover:bg-hover",
            )}
          >
            <span className="flex flex-col">
              <span className="text-base font-medium text-fg">{opcion.etiqueta}</span>
              {opcion.pista ? (
                <span className="text-sm text-fg-muted">{opcion.pista}</span>
              ) : null}
            </span>
            {marcada ? <Check size={16} strokeWidth={2.5} className="text-primary-fg" aria-hidden /> : null}
          </button>
        );
      })}

      {pregunta.multiple && elegidas.length > 0 ? (
        <Button size="sm" className="w-fit" onClick={() => enviarEleccion(elegidas)}>
          Confirmar {elegidas.length}
        </Button>
      ) : null}

      {pregunta.abierta ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            const limpio = escrito.trim();
            if (limpio.length === 0) return;
            onResponder(pregunta.clave, [limpio], [limpio]);
          }}
        >
          <Input
            value={escrito}
            onChange={(evento) => setEscrito(evento.target.value)}
            placeholder="…o escríbelo"
            aria-label={pregunta.enunciado}
          />
          <Button size="sm" variant="secondary" type="submit" disabled={escrito.trim().length === 0}>
            Enviar
          </Button>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 · Checklist de confirmación
// ---------------------------------------------------------------------------

export function BloqueChecklist({
  salida,
  editable,
  onEditar,
}: {
  salida: SalidaChecklist;
  editable: boolean;
  onEditar: (clave: string, valor: string) => void;
}) {
  return (
    <Card className="w-full">
      <CardBody className="flex flex-col gap-1 p-4">
        <p className="pb-2 text-base font-semibold text-fg">{salida.titulo}</p>
        {salida.items.map((item) => (
          <LineaChecklist
            key={item.clave}
            item={item}
            editable={editable && item.editable}
            onEditar={onEditar}
          />
        ))}
        {salida.aviso ? (
          <p className="pt-2 text-sm text-fg-muted">{salida.aviso}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function LineaChecklist({
  item,
  editable,
  onEditar,
}: {
  item: ItemChecklist;
  editable: boolean;
  onEditar: (clave: string, valor: string) => void;
}) {
  const [editando, setEditando] = React.useState(false);
  const [valor, setValor] = React.useState(item.valor);
  const [ultimoVisto, setUltimoVisto] = React.useState(item.valor);

  // Sincronizar durante el render, no en un efecto: un efecto provocaría un
  // segundo render con el valor viejo pintado por medio, y en un campo que se
  // está editando eso se ve como un parpadeo.
  if (ultimoVisto !== item.valor) {
    setUltimoVisto(item.valor);
    setValor(item.valor);
  }

  const guardar = (): void => {
    setEditando(false);
    const limpio = valor.trim();
    if (limpio.length > 0 && limpio !== item.valor) onEditar(item.clave, limpio);
    else setValor(item.valor);
  };

  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 border-b border-border-subtle py-2 last:border-0">
      <span className="text-sm text-fg-muted">{item.etiqueta}</span>
      {editando ? (
        <Input
          autoFocus
          value={valor}
          aria-label={item.etiqueta}
          onChange={(evento) => setValor(evento.target.value)}
          onBlur={guardar}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") guardar();
            if (evento.key === "Escape") {
              setValor(item.valor);
              setEditando(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!editable}
          onClick={() => setEditando(true)}
          className={cn(
            "-mx-1 rounded-sm px-1 py-0.5 text-left text-base text-fg",
            editable ? "hover:bg-hover" : "cursor-default",
          )}
        >
          {item.valor}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 · Tarjeta de entidad creada
// ---------------------------------------------------------------------------

export function BloqueTarjeta({ salida }: { salida: SalidaTarjeta }) {
  return (
    <div className="strap-muelle w-full overflow-hidden rounded-xl border border-border border-l-2 border-l-success bg-raised shadow-e2">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-lg font-semibold tracking-tight text-fg">{salida.nombre}</p>
            <p className="text-base text-fg-secondary">{salida.descripcion}</p>
          </div>
          <Badge tone="exito">
            {salida.version ? `Versión ${salida.version}` : "Listo"}
          </Badge>
        </div>

        {salida.detalles.length > 0 ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            {salida.detalles.map((detalle) => (
              <div key={detalle.etiqueta} className="flex flex-col">
                <dt className="text-2xs uppercase tracking-wide text-fg-muted">
                  {detalle.etiqueta}
                </dt>
                <dd className="text-base text-fg">{detalle.valor}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <a
          href={salida.enlace}
          className="inline-flex w-fit items-center gap-1.5 text-base font-medium text-primary-fg hover:underline"
        >
          {salida.textoEnlace}
          <ExternalLink size={15} strokeWidth={2} aria-hidden />
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 · Progreso de construcción
// ---------------------------------------------------------------------------

export function BloqueProgreso({
  salida,
  enMarcha,
}: {
  salida: SalidaProgreso;
  enMarcha: boolean;
}) {
  // Mientras la construcción corre, los pasos están abiertos; al terminar
  // colapsan solos a una línea. `desplegado` solo existe cuando la persona
  // decide lo contrario, y entonces manda ella.
  const [desplegado, setDesplegado] = React.useState<boolean | null>(null);
  const abierto = desplegado ?? enMarcha;

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setDesplegado(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-inset px-3 py-2 text-base text-fg-secondary transition-colors hover:bg-hover"
      >
        <Check size={15} strokeWidth={2.5} className="text-success-fg" aria-hidden />
        {salida.resumen}
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </button>
    );
  }

  return (
    <Card className="w-full">
      <CardBody className="flex flex-col gap-2 p-4">
        <p className="text-base font-semibold text-fg">{salida.titulo}</p>
        {salida.pasos.map((paso, indice) => (
          <div key={`${paso.etiqueta}-${indice}`} className="flex items-start gap-2">
            <IconoEstado estado={paso.estado} />
            <span className="flex flex-col">
              <span className="text-base text-fg">{paso.etiqueta}</span>
              {paso.detalle ? (
                <span className="text-sm text-fg-muted">{paso.detalle}</span>
              ) : null}
            </span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function IconoEstado({ estado }: { estado: SalidaProgreso["pasos"][number]["estado"] }) {
  const comun = "mt-0.5 shrink-0";
  if (estado === "hecho") {
    return <Check size={15} strokeWidth={2.5} className={cn(comun, "text-success-fg")} aria-hidden />;
  }
  if (estado === "fallido") {
    return <CircleAlert size={15} strokeWidth={2} className={cn(comun, "text-danger-fg")} aria-hidden />;
  }
  if (estado === "omitido") {
    return <Minus size={15} strokeWidth={2} className={cn(comun, "text-fg-muted")} aria-hidden />;
  }
  return (
    <Loader2
      size={15}
      strokeWidth={2}
      className={cn(comun, "animate-spin text-primary-fg")}
      aria-hidden
    />
  );
}

// ---------------------------------------------------------------------------
// El auto-juego
// ---------------------------------------------------------------------------

export function BloqueAutojuego({ salida }: { salida: SalidaAutojuego }) {
  return (
    <Card className="w-full">
      <CardBody className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Badge tone="ia">Prueba automática</Badge>
          <span className="text-sm text-fg-muted">{salida.guion}</span>
        </div>

        <div className="flex flex-col gap-2">
          {salida.turnos.map((turno, indice) => (
            <div
              key={indice}
              className={cn("flex", turno.quien === "cliente" ? "justify-start" : "justify-end")}
            >
              <p
                className={cn(
                  "max-w-[78%] rounded-2xl px-3 py-2 text-md",
                  turno.quien === "cliente"
                    ? "bg-inset text-fg"
                    : "bg-primary-soft text-fg",
                )}
              >
                {turno.texto}
              </p>
            </div>
          ))}
        </div>

        {salida.variables.length > 0 ? (
          <div className="rounded-lg border border-border bg-inset p-3">
            <p className="pb-1.5 text-2xs uppercase tracking-wide text-fg-muted">
              Lo que averiguó sin ayuda
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-1">
              {salida.variables.map((v) => (
                <div key={v.clave} className="flex items-baseline gap-2">
                  <dt className="text-sm text-fg-muted">{v.etiqueta}</dt>
                  <dd className="text-base font-medium text-fg">{v.valor}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {salida.aviso ? <p className="text-sm text-warning-fg">{salida.aviso}</p> : null}
      </CardBody>
    </Card>
  );
}
