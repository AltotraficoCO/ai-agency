"use client";

/**
 * El hilo con Strap.
 *
 * `useChat` del AI SDK y CERO parsing de texto: cada mensaje enriquecido sale
 * de una parte de herramienta tipada (`tool-preguntar`, `tool-publicar_agente`…)
 * y se pinta con el componente que le corresponde. Si mañana Strap aprende a
 * construir otra cosa, aparece una parte nueva y un `case` nuevo; el resto no
 * se toca.
 *
 * Elegir una opción NO manda al modelo un texto para que lo interprete: manda
 * la respuesta estructurada en `respuestas`, y el servidor la escribe en el
 * borrador antes de que el modelo abra la boca. Lo que el modelo ve es un
 * borrador ya actualizado, así que no puede volver a preguntarlo.
 *
 * Y nunca se deja a la persona mirando un spinner que no va a acabar: si el
 * turno termina sin nada que enseñar —una herramienta falló, el stream se
 * cortó—, se dice y se ofrece reintentar.
 */
import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button, IndicadorEscribiendo, Spinner } from "@strappy/ui";
import type {
  ModoConstruccion,
  SalidaHerramientaStrap,
  SalidaPreguntar,
} from "@/lib/meta/tipos";
import { Composer } from "./composer";
import { Orbe } from "./orbe";
import {
  BloqueAutojuego,
  BloqueChecklist,
  BloqueOpciones,
  BloqueProgreso,
  BloqueTarjeta,
  EstilosDeStrap,
  type RespuestaDeBloque,
} from "./partes";
import { TextoStrap, limpiarTextoStrap } from "./texto-strap";
import { RegistroTrabajo, type PasoVista } from "@/components/conversacion/registro-trabajo";

export interface HiloProps {
  hiloId: string;
  mensajesIniciales: UIMessage[];
  borradorInicial: Record<string, unknown>;
  modoInicial: ModoConstruccion;
  maxDisponible: boolean;
  /** Mensaje que se envía solo al abrir. Viene del chip o del composer de inicio. */
  mensajeDeApertura?: string;
}

export function Hilo({
  hiloId,
  mensajesIniciales,
  borradorInicial,
  modoInicial,
  maxDisponible,
  mensajeDeApertura,
}: HiloProps) {
  const [modo, setModo] = React.useState<ModoConstruccion>(modoInicial);
  const [texto, setTexto] = React.useState("");
  const [borrador, setBorrador] = React.useState(borradorInicial);
  const fondo = React.useRef<HTMLDivElement>(null);

  const { messages, sendMessage, regenerate, status, error, clearError } = useChat({
    id: hiloId,
    messages: mensajesIniciales,
    transport: new DefaultChatTransport({ api: "/api/meta/chat" }),
    onFinish: () => {
      void refrescarBorrador(hiloId).then((nuevo) => {
        if (nuevo) setBorrador(nuevo);
      });
    },
  });

  const ocupado = status === "submitted" || status === "streaming";

  const enviar = React.useCallback(
    (contenido: string, respuestas?: { clave: string; valores: string[] }[]) => {
      void sendMessage(
        { text: contenido },
        { body: { hiloId, modo, ...(respuestas ? { respuestas } : {}) } },
      );
    },
    [sendMessage, hiloId, modo],
  );

  const reintentar = (): void => {
    clearError();
    void regenerate({ body: { hiloId, modo } });
  };

  // El mensaje con el que se abrió el hilo se manda una sola vez, aunque React
  // monte el componente dos veces en desarrollo.
  const abierto = React.useRef(false);
  React.useEffect(() => {
    if (abierto.current) return;
    abierto.current = true;
    if (mensajeDeApertura && mensajesIniciales.length === 0) enviar(mensajeDeApertura);
  }, [mensajeDeApertura, mensajesIniciales.length, enviar]);

  React.useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const responder = (respuestas: RespuestaDeBloque[]): void => {
    // Optimista: los chips con check aparecen antes de que vuelva el servidor.
    setBorrador((previo) =>
      respuestas.reduce(
        (acumulado, r) => escribirEnRutaLocal(acumulado, r.clave, r.etiquetas.join(", ")),
        previo,
      ),
    );
    enviar(
      respuestas.map((r) => r.etiquetas.join(", ")).join(" · "),
      respuestas.map(({ clave, valores }) => ({ clave, valores })),
    );
  };

  const editarLinea = (clave: string, valor: string): void => {
    setBorrador((previo) => escribirEnRutaLocal(previo, clave, valor));
    void fetch("/api/meta/borrador", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hiloId, respuestas: [{ clave, valores: [valor] }] }),
    });
  };

  const ultimo = messages[messages.length - 1];
  const atascado = !ocupado && !error && ultimo !== undefined && !terminoBien(ultimo);

  return (
    <div className="flex h-full flex-col">
      <EstilosDeStrap />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-5 py-8">
          {messages.map((mensaje) => (
            <Mensaje
              key={mensaje.id}
              mensaje={mensaje}
              esUltimo={mensaje.id === ultimo?.id}
              borrador={borrador}
              onResponder={responder}
              onEditar={editarLinea}
              ocupado={ocupado}
            />
          ))}

          {esperandoRespuesta(status, ultimo) ? (
            <div className="strappy-fade-in flex items-start gap-3">
              <Orbe size={32} pose="construyendo" quieto />
              <span className="rounded-2xl rounded-tl-md border border-border bg-raised px-4 py-3.5">
                <IndicadorEscribiendo etiqueta="Strap está escribiendo" />
              </span>
            </div>
          ) : null}

          {error || atascado ? (
            <AvisoDeCorte
              detalle={error ? error.message : ultimoError(ultimo)}
              onReintentar={reintentar}
            />
          ) : null}

          <div ref={fondo} />
        </div>
      </div>

      <div className="border-t border-border bg-page">
        <div className="mx-auto w-full max-w-[760px] px-5 py-4">
          <Composer
            valor={texto}
            onCambio={setTexto}
            onEnviar={() => {
              const limpio = texto.trim();
              if (limpio.length === 0) return;
              setTexto("");
              clearError();
              enviar(limpio);
            }}
            modo={modo}
            onModo={setModo}
            maxDisponible={maxDisponible}
            ocupado={ocupado}
            placeholder="Responde o cuéntame otra cosa…"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AvisoDeCorte({
  detalle,
  onReintentar,
}: {
  detalle: string | null;
  onReintentar: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-border bg-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <p className="text-base text-fg">Me quedé a medias con esta respuesta.</p>
          <p className="text-sm text-fg-muted">
            {detalle ? `Detalle: ${recortar(detalle, 160)}` : "Vuelve a intentarlo y sigo donde íbamos."}
          </p>
        </div>
      </div>
      <Button size="sm" variant="secondary" className="w-fit shrink-0" onClick={onReintentar}>
        <RotateCcw size={14} strokeWidth={2} aria-hidden />
        Reintentar
      </Button>
    </div>
  );
}

function Mensaje({
  mensaje,
  esUltimo,
  borrador,
  onResponder,
  onEditar,
  ocupado,
}: {
  mensaje: UIMessage;
  esUltimo: boolean;
  borrador: Record<string, unknown>;
  onResponder: (respuestas: RespuestaDeBloque[]) => void;
  onEditar: (clave: string, valor: string) => void;
  ocupado: boolean;
}) {
  if (mensaje.role === "user") {
    return (
      <div className="strappy-slide-up flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-selected px-4 py-2.5 text-md text-fg">
          {textoDe(mensaje)}
        </p>
      </div>
    );
  }

  return (
    <div className="strappy-slide-up flex gap-3">
      <Orbe size={32} pose="esperando" quieto={!ocupado} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {segmentar(mensaje, esUltimo && ocupado).map((segmento) =>
          segmento.clase === "parte" ? (
            <ParteDelAgente
              key={segmento.clave}
              parte={segmento.parte}
              esUltimo={esUltimo}
              enCurso={esUltimo && ocupado}
              borrador={borrador}
              onResponder={onResponder}
              onEditar={onEditar}
            />
          ) : (
            <React.Fragment key={segmento.clave}>
              {segmento.pasos.length > 0 ? (
                <RegistroTrabajo
                  pasos={segmento.pasos}
                  activo={esUltimo && ocupado && segmento.pasos.some((p) => p.estado === "en_curso")}
                  textoActivo="Strap está trabajando…"
                />
              ) : null}
              {segmento.bloques.map((bloque) => (
                <ParteDelAgente
                  key={bloque.clave}
                  parte={bloque.parte}
                  esUltimo={esUltimo}
                  enCurso={esUltimo && ocupado}
                  borrador={borrador}
                  onResponder={onResponder}
                  onEditar={onEditar}
                />
              ))}
            </React.Fragment>
          ),
        )}
      </div>
    </div>
  );
}

function ParteDelAgente({
  parte,
  esUltimo,
  enCurso,
  borrador,
  onResponder,
  onEditar,
}: {
  parte: UIMessage["parts"][number];
  esUltimo: boolean;
  /** Este mensaje se está escribiendo ahora mismo. */
  enCurso: boolean;
  borrador: Record<string, unknown>;
  onResponder: (respuestas: RespuestaDeBloque[]) => void;
  onEditar: (clave: string, valor: string) => void;
}) {
  if (parte.type === "text") {
    if (limpiarTextoStrap(parte.text).length === 0) return null;
    return (
      <div className="w-fit max-w-full rounded-2xl rounded-tl-md border border-border bg-raised px-4 py-2.5">
        <TextoStrap texto={parte.text} />
      </div>
    );
  }

  if (!isToolUIPart(parte)) return null;

  if (parte.state === "input-streaming" || parte.state === "input-available") {
    // Mientras la herramienta corre se dice qué está haciendo. «Leyendo tu
    // sitio web…» tranquiliza; un spinner no. Si el turno ya terminó y la
    // herramienta sigue sin resultado, el stream se cortó: no se finge que
    // sigue trabajando, lo cuenta el aviso de abajo.
    if (!enCurso) return null;
    return (
      <p className="strappy-fade-in inline-flex w-fit items-center gap-2 rounded-full border border-border bg-inset px-3 py-1.5 text-sm text-fg-secondary">
        <Spinner size="sm" label="" />
        {enMarcha(parte.type)}
      </p>
    );
  }

  // Un paso que falló no se pinta: o el modelo lo corrige en el paso siguiente,
  // o el turno acaba sin nada visible y aparece el aviso con Reintentar.
  if (parte.state !== "output-available") return null;

  const salida = parte.output as SalidaHerramientaStrap | undefined;
  if (!salida || typeof salida !== "object" || !("tipo" in salida)) return null;

  switch (salida.tipo) {
    case "preguntas":
      return (
        <BloqueOpciones
          preguntas={(salida as SalidaPreguntar).preguntas}
          respondidas={respondidasDe(salida as SalidaPreguntar, borrador)}
          interactivo={esUltimo && !enCurso}
          onResponder={onResponder}
        />
      );
    case "checklist":
      return <BloqueChecklist salida={salida} editable={esUltimo} onEditar={onEditar} />;
    case "tarjeta":
      return <BloqueTarjeta salida={salida} />;
    case "progreso":
      return <BloqueProgreso salida={salida} enMarcha={enCurso} />;
    case "autojuego":
      return <BloqueAutojuego salida={salida} />;
    default:
      // `contexto`, `borrador` y `texto` son trabajo interno de Strap: se ven
      // en sus efectos, no como una caja más en la conversación.
      return null;
  }
}

const EN_MARCHA: Readonly<Record<string, string>> = {
  "tool-leer_contexto_empresa": "Repasando lo que sé de tu negocio…",
  "tool-analizar_sitio_web": "Leyendo tu sitio web…",
  "tool-preguntar": "Preparando las preguntas…",
  "tool-draft_leer": "Repasando lo que ya me contaste…",
  "tool-draft_actualizar": "Guardando lo que me dijiste…",
  "tool-proponer_variables_extraccion": "Eligiendo qué datos pedirle a tus clientes…",
  "tool-crear_brain_desde_fuentes": "Preparando el conocimiento…",
  "tool-publicar_agente": "Publicando tu agente…",
  "tool-probar_agente": "Probándolo con un cliente de mentira…",
  "tool-generar_prompt_agente": "Escribiendo sus instrucciones…",
  "tool-confirmar_construccion": "Armando la ficha…",
  "tool-mostrar_tarjeta_agente": "Preparando la tarjeta de tu agente…",
};

function enMarcha(tipo: string): string {
  return EN_MARCHA[tipo] ?? "Trabajando en ello…";
}

type ParteMensaje = UIMessage["parts"][number];

type Segmento =
  | { clase: "parte"; parte: ParteMensaje; clave: string }
  | { clase: "trabajo"; pasos: PasoVista[]; bloques: { parte: ParteMensaje; clave: string }[]; clave: string };

/**
 * Parte un mensaje de Strap en lo que se lee y lo que hizo.
 *
 * Las herramientas seguidas se juntan en un registro de trabajo colapsable
 * («Strap trabajó 4 pasos»), en vez de una pastilla por cada una. Las que
 * enseñan algo —preguntas, ficha, tarjeta, progreso, prueba— cuentan como paso
 * y además se pintan debajo del registro, en su sitio de siempre.
 */
function segmentar(mensaje: UIMessage, enCurso: boolean): Segmento[] {
  const segmentos: Segmento[] = [];
  let grupo: Extract<Segmento, { clase: "trabajo" }> | null = null;

  for (const [indice, parte] of mensaje.parts.entries()) {
    const clave = `${mensaje.id}-${indice}`;
    if (!isToolUIPart(parte)) {
      grupo = null;
      segmentos.push({ clase: "parte", parte, clave });
      continue;
    }
    if (!grupo) {
      grupo = { clase: "trabajo", pasos: [], bloques: [], clave };
      segmentos.push(grupo);
    }
    const paso = pasoDe(parte, enCurso);
    if (paso) grupo.pasos.push(paso);
    const salida = parte.state === "output-available" ? (parte.output as { tipo?: unknown } | undefined) : undefined;
    if (typeof salida?.tipo === "string" && SALIDAS_VISIBLES.has(salida.tipo)) {
      grupo.bloques.push({ parte, clave });
    }
  }
  return segmentos;
}

/** Una herramienta de Strap contada como paso del registro. */
function pasoDe(parte: Extract<ParteMensaje, { toolCallId: string }>, enCurso: boolean): PasoVista | null {
  const enMarchaTexto = enMarcha(parte.type);
  const hecho = enMarchaTexto.replace(/…$/, "");
  switch (parte.state) {
    case "output-available":
      return { id: parte.toolCallId, etiqueta: hecho, estado: "hecho" };
    case "output-error":
      return { id: parte.toolCallId, etiqueta: hecho, estado: "error", detalle: "No salió a la primera." };
    case "input-streaming":
    case "input-available":
      // Sin turno en curso, una llamada sin resultado es un corte: lo cuenta el aviso de abajo.
      return enCurso ? { id: parte.toolCallId, etiqueta: enMarchaTexto, estado: "en_curso" } : null;
    default:
      return null;
  }
}

const SALIDAS_VISIBLES = new Set(["preguntas", "checklist", "tarjeta", "progreso", "autojuego"]);

/**
 * True si el último mensaje deja a la persona con algo que leer o que hacer.
 *
 * Un turno que acaba en una herramienta fallida, en una llamada sin resultado
 * o en un mensaje de la persona sin respuesta es un turno cortado, aunque el
 * chat diga que ya terminó.
 */
/**
 * Los tres puntos salen mientras no hay nada que leer: al enviar, y durante el
 * stream hasta que llega la primera palabra o empieza una herramienta (que ya
 * dice lo que hace con su propia etiqueta).
 */
function esperandoRespuesta(status: string, ultimo: UIMessage | undefined): boolean {
  if (status === "submitted") return true;
  if (status !== "streaming") return false;
  if (!ultimo || ultimo.role !== "assistant") return true;
  return !ultimo.parts.some(
    (parte) =>
      (parte.type === "text" && limpiarTextoStrap(parte.text).length > 0) || isToolUIPart(parte),
  );
}

function terminoBien(mensaje: UIMessage): boolean {
  if (mensaje.role !== "assistant") return false;
  return mensaje.parts.some((parte) => {
    if (parte.type === "text") return limpiarTextoStrap(parte.text).length > 0;
    if (!isToolUIPart(parte) || parte.state !== "output-available") return false;
    const salida = parte.output as { tipo?: unknown } | undefined;
    return typeof salida?.tipo === "string" && SALIDAS_VISIBLES.has(salida.tipo);
  });
}

function ultimoError(mensaje: UIMessage | undefined): string | null {
  if (!mensaje) return null;
  for (const parte of [...mensaje.parts].reverse()) {
    if (isToolUIPart(parte) && parte.state === "output-error") return parte.errorText;
  }
  return null;
}

function recortar(texto: string, maximo: number): string {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

function textoDe(mensaje: UIMessage): string {
  return mensaje.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

/**
 * Lo ya contestado, leído del borrador: la única fuente de verdad del check.
 *
 * Se traduce el valor guardado a la etiqueta que la persona vio al elegir. El
 * borrador guarda `whatsapp` porque es lo que entiende el sistema; el chip
 * tiene que decir «WhatsApp», que es lo que ella pulsó.
 */
function respondidasDe(
  salida: SalidaPreguntar,
  borrador: Record<string, unknown>,
): Record<string, string> {
  const salidaMapa: Record<string, string> = {};
  for (const pregunta of salida.preguntas) {
    const valor = leerRutaLocal(borrador, pregunta.clave);
    if (valor.length === 0) continue;
    const etiquetas = valor
      .split(", ")
      .map((v) => pregunta.opciones.find((o) => o.valor === v)?.etiqueta ?? v);
    salidaMapa[pregunta.clave] = etiquetas.join(", ");
  }
  return salidaMapa;
}

function leerRutaLocal(objeto: Record<string, unknown>, ruta: string): string {
  let actual: unknown = objeto;
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return "";
    actual = (actual as Record<string, unknown>)[parte];
  }
  if (Array.isArray(actual)) {
    return actual
      .map((v) =>
        v !== null && typeof v === "object" && "etiqueta" in v
          ? String((v as { etiqueta: unknown }).etiqueta)
          : String(v),
      )
      .join(", ");
  }
  return actual === undefined || actual === null ? "" : String(actual);
}

function escribirEnRutaLocal(
  objeto: Record<string, unknown>,
  ruta: string,
  valor: string,
): Record<string, unknown> {
  const partes = ruta.split(".");
  const copia: Record<string, unknown> = { ...objeto };
  let nivel = copia;
  for (let i = 0; i < partes.length - 1; i++) {
    const clave = partes[i]!;
    const hijo = nivel[clave];
    const siguiente: Record<string, unknown> =
      hijo !== null && typeof hijo === "object" && !Array.isArray(hijo)
        ? { ...(hijo as Record<string, unknown>) }
        : {};
    nivel[clave] = siguiente;
    nivel = siguiente;
  }
  nivel[partes[partes.length - 1]!] = valor;
  return copia;
}

async function refrescarBorrador(hiloId: string): Promise<Record<string, unknown> | null> {
  try {
    const respuesta = await fetch(`/api/meta/borrador?hiloId=${encodeURIComponent(hiloId)}`);
    if (!respuesta.ok) return null;
    const cuerpo = (await respuesta.json()) as { borrador?: Record<string, unknown> };
    return cuerpo.borrador ?? null;
  } catch {
    return null;
  }
}
