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
 */
import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { Spinner } from "@strappy/ui";
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
} from "./partes";

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

  const { messages, sendMessage, status, error } = useChat({
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
  }, [messages]);

  const responder = (clave: string, valores: string[], etiquetas: string[]): void => {
    // Optimista: el chip con check aparece antes de que vuelva el servidor.
    setBorrador((previo) => escribirEnRutaLocal(previo, clave, etiquetas.join(", ")));
    enviar(etiquetas.join(", "), [{ clave, valores }]);
  };

  const editarLinea = (clave: string, valor: string): void => {
    setBorrador((previo) => escribirEnRutaLocal(previo, clave, valor));
    void fetch("/api/meta/borrador", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hiloId, respuestas: [{ clave, valores: [valor] }] }),
    });
  };

  const ultimoId = messages[messages.length - 1]?.id;

  return (
    <div className="flex h-full flex-col">
      <EstilosDeStrap />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-5 py-8">
          {messages.map((mensaje) => (
            <Mensaje
              key={mensaje.id}
              mensaje={mensaje}
              esUltimo={mensaje.id === ultimoId}
              borrador={borrador}
              onResponder={responder}
              onEditar={editarLinea}
              ocupado={ocupado}
            />
          ))}

          {status === "submitted" ? (
            <div className="flex items-center gap-3 text-fg-muted">
              <Orbe size={32} pose="construyendo" />
              <Spinner label="Strap está trabajando" />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-base text-danger-fg">
              {error.message}
            </p>
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
  onResponder: (clave: string, valores: string[], etiquetas: string[]) => void;
  onEditar: (clave: string, valor: string) => void;
  ocupado: boolean;
}) {
  if (mensaje.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl bg-selected px-4 py-2.5 text-md text-fg">
          {textoDe(mensaje)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Orbe size={32} pose="esperando" quieto={!ocupado} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {mensaje.parts.map((parte, indice) => (
          <ParteDelAgente
            key={`${mensaje.id}-${indice}`}
            parte={parte}
            esUltimo={esUltimo}
            borrador={borrador}
            onResponder={onResponder}
            onEditar={onEditar}
          />
        ))}
      </div>
    </div>
  );
}

function ParteDelAgente({
  parte,
  esUltimo,
  borrador,
  onResponder,
  onEditar,
}: {
  parte: UIMessage["parts"][number];
  esUltimo: boolean;
  borrador: Record<string, unknown>;
  onResponder: (clave: string, valores: string[], etiquetas: string[]) => void;
  onEditar: (clave: string, valor: string) => void;
}) {
  if (parte.type === "text") {
    if (parte.text.trim().length === 0) return null;
    return <p className="whitespace-pre-wrap text-md text-fg">{parte.text}</p>;
  }

  if (!isToolUIPart(parte)) return null;

  if (parte.state !== "output-available") {
    // Mientras la herramienta corre no se enseña un esqueleto genérico: se dice
    // qué está haciendo. «Leyendo tu sitio web…» tranquiliza; un spinner no.
    return (
      <p className="inline-flex items-center gap-2 text-base text-fg-muted">
        <Spinner size="sm" label="" />
        {enMarcha(parte.type)}
      </p>
    );
  }

  const salida = parte.output as SalidaHerramientaStrap | undefined;
  if (!salida || typeof salida !== "object" || !("tipo" in salida)) return null;

  switch (salida.tipo) {
    case "preguntas":
      return (
        <BloqueOpciones
          preguntas={(salida as SalidaPreguntar).preguntas}
          respondidas={respondidasDe(salida as SalidaPreguntar, borrador)}
          interactivo={esUltimo}
          onResponder={onResponder}
        />
      );
    case "checklist":
      return <BloqueChecklist salida={salida} editable={esUltimo} onEditar={onEditar} />;
    case "tarjeta":
      return <BloqueTarjeta salida={salida} />;
    case "progreso":
      return <BloqueProgreso salida={salida} enMarcha={esUltimo} />;
    case "autojuego":
      return <BloqueAutojuego salida={salida} />;
    default:
      // `contexto`, `borrador` y `texto` son trabajo interno de Strap: se ven
      // en sus efectos, no como una caja más en la conversación.
      return null;
  }
}

const EN_MARCHA: Readonly<Record<string, string>> = {
  "tool-analizar_sitio_web": "Leyendo tu sitio web…",
  "tool-crear_brain_desde_fuentes": "Preparando el conocimiento…",
  "tool-publicar_agente": "Publicando tu agente…",
  "tool-probar_agente": "Probándolo con un cliente de mentira…",
  "tool-generar_prompt_agente": "Escribiendo sus instrucciones…",
  "tool-confirmar_construccion": "Armando la ficha…",
};

function enMarcha(tipo: string): string {
  return EN_MARCHA[tipo] ?? "Un momento…";
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
