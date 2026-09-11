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
import Image from "next/image";
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

/** Lo que la persona contestó a una pregunta del bloque. */
export type RespuestaDeBloque = {
  readonly clave: string;
  readonly valores: string[];
  readonly etiquetas: string[];
};

/**
 * Las preguntas de una ronda se contestan JUNTAS y se mandan de una vez.
 *
 * Antes cada clic mandaba su pregunta por separado: la primera respuesta abría
 * un turno nuevo, el bloque dejaba de ser el último mensaje y las otras dos
 * preguntas se quedaban congeladas en «sin responder». Ahora se marca todo y
 * se pulsa Continuar.
 *
 * Una sola pregunta de opción única es la excepción: ahí el clic ya es la
 * respuesta completa y pedir un segundo clic sería burocracia.
 */
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
  onResponder: (respuestas: RespuestaDeBloque[]) => void;
}) {
  const [elegidas, setElegidas] = React.useState<Record<string, string[]>>({});
  const [escritas, setEscritas] = React.useState<Record<string, string>>({});

  const pendientes = interactivo
    ? preguntas.filter((p) => (respondidas[p.clave] ?? "").length === 0)
    : [];

  const respuestaDe = (pregunta: PreguntaRenderizada): RespuestaDeBloque | null => {
    const marcadas = elegidas[pregunta.clave] ?? [];
    const escrito = (escritas[pregunta.clave] ?? "").trim();
    const valores = [...marcadas, ...(escrito.length > 0 ? [escrito] : [])];
    if (valores.length === 0) return null;
    return {
      clave: pregunta.clave,
      valores,
      etiquetas: valores.map((v) => pregunta.opciones.find((o) => o.valor === v)?.etiqueta ?? v),
    };
  };

  const listas = pendientes.map(respuestaDe).filter((r): r is RespuestaDeBloque => r !== null);
  const faltan = pendientes.length - listas.length;
  const unClic =
    pendientes.length === 1 && !pendientes[0]!.multiple && !pendientes[0]!.abierta;

  const elegir = (pregunta: PreguntaRenderizada, valor: string): void => {
    if (unClic) {
      const etiqueta = pregunta.opciones.find((o) => o.valor === valor)?.etiqueta ?? valor;
      onResponder([{ clave: pregunta.clave, valores: [valor], etiquetas: [etiqueta] }]);
      return;
    }
    setElegidas((previas) => {
      const actuales = previas[pregunta.clave] ?? [];
      const siguientes = pregunta.multiple
        ? actuales.includes(valor)
          ? actuales.filter((v) => v !== valor)
          : [...actuales, valor]
        : actuales.includes(valor)
          ? []
          : [valor];
      return { ...previas, [pregunta.clave]: siguientes };
    });
    // En opción única, elegir un botón sustituye lo escrito: son la misma respuesta.
    if (!pregunta.multiple) setEscritas((previas) => ({ ...previas, [pregunta.clave]: "" }));
  };

  const escribir = (pregunta: PreguntaRenderizada, texto: string): void => {
    setEscritas((previas) => ({ ...previas, [pregunta.clave]: texto }));
    if (!pregunta.multiple && texto.trim().length > 0) {
      setElegidas((previas) => ({ ...previas, [pregunta.clave]: [] }));
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (faltan === 0 && listas.length > 0) onResponder(listas);
      }}
    >
      {preguntas.map((pregunta) => {
        const guardada = respondidas[pregunta.clave] ?? "";
        if (guardada.length > 0 || !interactivo) {
          return <PreguntaContestada key={pregunta.clave} pregunta={pregunta} respuesta={guardada} />;
        }
        return (
          <Pregunta
            key={pregunta.clave}
            pregunta={pregunta}
            marcadas={elegidas[pregunta.clave] ?? []}
            escrito={escritas[pregunta.clave] ?? ""}
            onElegir={(valor) => elegir(pregunta, valor)}
            onEscribir={(texto) => escribir(pregunta, texto)}
          />
        );
      })}

      {pendientes.length > 0 && !unClic ? (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={faltan > 0}>
            Continuar
          </Button>
          {faltan > 0 && pendientes.length > 1 ? (
            <span className="text-sm text-fg-muted">
              {faltan === 1 ? "Te falta 1 pregunta" : `Te faltan ${faltan} preguntas`}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function PreguntaContestada({
  pregunta,
  respuesta,
}: {
  pregunta: PreguntaRenderizada;
  respuesta: string;
}) {
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

function Pregunta({
  pregunta,
  marcadas,
  escrito,
  onElegir,
  onEscribir,
}: {
  pregunta: PreguntaRenderizada;
  marcadas: readonly string[];
  escrito: string;
  onElegir: (valor: string) => void;
  onEscribir: (texto: string) => void;
}) {
  const idEnunciado = React.useId();

  return (
    <div
      role={pregunta.multiple ? "group" : "radiogroup"}
      aria-labelledby={idEnunciado}
      className="flex flex-col gap-2"
    >
      <p id={idEnunciado} className="text-md text-fg">
        {pregunta.enunciado}
        {pregunta.multiple ? (
          <span className="ml-2 text-sm text-fg-muted">Puedes elegir varias</span>
        ) : null}
      </p>

      {pregunta.opciones.slice(0, 4).map((opcion) => {
        const marcada = marcadas.includes(opcion.valor);
        return (
          <button
            key={`${pregunta.clave}:${opcion.valor}`}
            type="button"
            role={pregunta.multiple ? "checkbox" : "radio"}
            aria-checked={marcada}
            onClick={() => onElegir(opcion.valor)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-[color,background-color,border-color,transform] duration-[--dur-fast] active:scale-[0.99] motion-reduce:active:scale-100",
              marcada
                ? "border-primary bg-primary-soft"
                : "border-border bg-raised hover:border-border-strong hover:bg-hover",
            )}
          >
            <Marca multiple={pregunta.multiple} marcada={marcada} />
            <span className="flex flex-col">
              <span className="text-base font-medium text-fg">{opcion.etiqueta}</span>
              {opcion.pista ? <span className="text-sm text-fg-muted">{opcion.pista}</span> : null}
            </span>
          </button>
        );
      })}

      {pregunta.abierta ? (
        <Input
          value={escrito}
          onChange={(evento) => onEscribir(evento.target.value)}
          placeholder={
            pregunta.opciones.length > 0
              ? pregunta.multiple
                ? "Algo más que no esté en la lista…"
                : "…o escríbelo"
              : "Escribe tu respuesta"
          }
          aria-label={pregunta.enunciado}
        />
      ) : null}
    </div>
  );
}

/** Cuadrado si se eligen varias, círculo si solo una: se sabe antes de pulsar. */
function Marca({ multiple, marcada }: { multiple: boolean; marcada: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center border-2 transition-colors",
        multiple ? "rounded-[5px]" : "rounded-full",
        marcada ? "border-primary bg-primary text-[var(--fg-on-brand)]" : "border-border-strong",
      )}
    >
      {marcada ? (
        multiple ? (
          <Check size={12} strokeWidth={3} />
        ) : (
          <span className="size-2 rounded-full bg-[var(--fg-on-brand)]" />
        )
      ) : null}
    </span>
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
    <Card className="strappy-slide-up w-full border-l-2 border-l-primary">
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
            editable ? "cursor-pointer hover:bg-hover" : "cursor-default",
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
    <div className="strap-muelle w-full overflow-hidden rounded-xl border border-border border-l-2 border-l-primary bg-raised shadow-e2">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          {salida.foto ? (
            <Image
              src={salida.foto}
              alt=""
              width={72}
              height={72}
              className="-my-1 size-[72px] shrink-0 object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-inset px-3 py-2 text-base text-fg-secondary transition-colors hover:border-border-strong hover:bg-hover hover:text-fg"
      >
        <Check size={15} strokeWidth={2.5} className="text-success-fg" aria-hidden />
        {salida.resumen}
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </button>
    );
  }

  return (
    <Card className="strappy-slide-up w-full border-l-2 border-l-primary">
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
    <Card className="strappy-slide-up w-full border-l-2 border-l-primary">
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
                  // La IA en neutro con borde, como en el resto de chats: sin verde sobre verde.
                  turno.quien === "cliente"
                    ? "bg-inset text-fg"
                    : "border border-border bg-hover text-fg",
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
