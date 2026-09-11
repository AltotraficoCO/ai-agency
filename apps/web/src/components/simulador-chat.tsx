"use client";

/**
 * El simulador.
 *
 * No es una maqueta: cada mensaje pasa por el motor real, se guarda en
 * `messages` y descuenta créditos de `credit_wallets`. Por eso la barra de
 * abajo enseña los créditos que costó ESTE turno: probar cuesta dinero y
 * ocultarlo sería mentir sobre el producto.
 *
 * Arranca con sugerencias pulsables: frente a una caja vacía nadie sabe qué
 * escribirle a su propio agente, y el primer mensaje es el que más cuesta.
 */
import * as React from "react";
import { FlaskConical, RotateCcw, Send } from "lucide-react";
import Image from "next/image";
import { Avatar, Badge, Button, IndicadorEscribiendo, Input, cn } from "@strappy/ui";

export type MensajeVista = {
  id: string;
  autor: "contacto" | "agente" | "sistema";
  texto: string;
  fecha: string;
};

export interface SimuladorChatProps {
  agentId: string;
  conversationId: string;
  historial: MensajeVista[];
  nombreAgente: string;
  /** Foto de plastilina del agente; sin ella se enseñan sus iniciales. */
  fotoAgente?: string | null;
  saldoInicial: number;
  modeloDeEnsayo: boolean;
}

type Resultado = {
  estado: "replied" | "skipped" | "error";
  motivo?: string;
  respuesta?: string;
  creditos: number;
  pasos: number;
  saldo: number;
  milisegundos: number;
};

const SUGERENCIAS = [
  "Hola, ¿a qué hora abren hoy?",
  "¿Cuánto cuesta?",
  "Quiero hacer un pedido",
  "Necesito hablar con una persona",
];

export function SimuladorChat({
  agentId,
  conversationId,
  historial,
  nombreAgente,
  fotoAgente,
  saldoInicial,
  modeloDeEnsayo,
}: SimuladorChatProps) {
  const [mensajes, setMensajes] = React.useState<MensajeVista[]>(historial);
  const [texto, setTexto] = React.useState("");
  const [pensando, setPensando] = React.useState(false);
  const [ultimo, setUltimo] = React.useState<Resultado | null>(null);
  const [saldo, setSaldo] = React.useState(saldoInicial);
  const [error, setError] = React.useState<string | null>(null);
  const [reiniciando, setReiniciando] = React.useState(false);
  const final = React.useRef<HTMLDivElement>(null);
  const caja = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, pensando]);

  async function enviarTexto(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || pensando) return;

    setTexto("");
    setError(null);
    setMensajes((previos) => [
      ...previos,
      { id: `local-${Date.now()}`, autor: "contacto", texto: limpio, fecha: new Date().toISOString() },
    ]);
    setPensando(true);

    try {
      const respuesta = await fetch(`/api/agentes/${agentId}/simulador`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, texto: limpio }),
      });
      if (!respuesta.body) throw new Error("El servidor no devolvió ningún flujo.");

      for await (const evento of leerEventos(respuesta.body)) {
        if (evento.tipo === "resultado") {
          const r = evento.datos as Resultado;
          setUltimo(r);
          setSaldo(r.saldo);
          if (r.respuesta) {
            setMensajes((previos) => [
              ...previos,
              {
                id: `agente-${Date.now()}`,
                autor: "agente",
                texto: r.respuesta!,
                fecha: new Date().toISOString(),
              },
            ]);
          } else if (r.motivo) {
            setMensajes((previos) => [
              ...previos,
              { id: `sistema-${Date.now()}`, autor: "sistema", texto: r.motivo!, fecha: new Date().toISOString() },
            ]);
          }
        }
        if (evento.tipo === "error") {
          setError((evento.datos as { mensaje: string }).mensaje);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo hablar con el simulador.");
    } finally {
      setPensando(false);
      caja.current?.focus();
    }
  }

  async function reiniciar() {
    setReiniciando(true);
    await fetch(`/api/agentes/${agentId}/simulador/reiniciar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    setReiniciando(false);
    setMensajes([]);
    setUltimo(null);
    setError(null);
  }

  const vacio = mensajes.length === 0 && !pensando;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      {/* ── Con quién hablas ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <FotoAgente nombre={nombreAgente} src={fotoAgente} size="lg" tone="ia" status="en-linea" />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-base font-semibold text-fg">{nombreAgente}</p>
          <p className="flex items-center gap-1.5 truncate text-2xs text-fg-muted">
            <FlaskConical size={12} aria-hidden />
            Modo prueba: nadie de fuera recibe estos mensajes
          </p>
        </div>
        {modeloDeEnsayo && (
          <Badge tone="aviso" title="No hay AI_GATEWAY_API_KEY configurada">
            Modelo de ensayo
          </Badge>
        )}
        {mensajes.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={reiniciar} loading={reiniciando}>
            <RotateCcw size={16} aria-hidden />
            Empezar de nuevo
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {vacio && (
          <div className="strappy-slide-up mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
            <FotoAgente nombre={nombreAgente} src={fotoAgente} size="lg" tone="ia" className="size-14 text-lg" />
            <div className="flex flex-col gap-1">
              <p className="text-xl font-semibold text-fg">Háblale como si fueras un cliente</p>
              <p className="text-base text-fg-secondary">
                {nombreAgente} responderá con las instrucciones que le diste. Empieza por una de estas o
                escribe la tuya.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGERENCIAS.map((sugerencia) => (
                <button
                  key={sugerencia}
                  type="button"
                  onClick={() => void enviarTexto(sugerencia)}
                  className="cursor-pointer rounded-full border border-border bg-raised px-3.5 py-2 text-sm text-fg-secondary transition-colors hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg"
                >
                  {sugerencia}
                </button>
              ))}
            </div>
          </div>
        )}
        <ol className="flex flex-col gap-3">
          {mensajes.map((m) => (
            <li
              key={m.id}
              className={
                m.autor === "contacto"
                  ? "strappy-slide-up flex justify-end"
                  : "strappy-slide-up flex justify-start"
              }
            >
              {m.autor === "sistema" ? (
                <p className="mx-auto max-w-md rounded-md bg-hover px-3 py-1.5 text-center text-2xs text-fg-muted">
                  {m.texto}
                </p>
              ) : (
                <div className="flex max-w-[80%] items-end gap-2">
                  {m.autor === "agente" && <FotoAgente nombre={nombreAgente} src={fotoAgente} size="sm" tone="ia" />}
                  {/* La IA habla en neutro con borde; el verde sobre verde cansaba la vista. */}
                  <p
                    className={
                      m.autor === "contacto"
                        ? "whitespace-pre-wrap rounded-2xl rounded-br-sm bg-selected px-3.5 py-2 text-md text-fg"
                        : "whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-border bg-raised px-3.5 py-2 text-md text-fg"
                    }
                  >
                    {m.texto}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
        {pensando && (
          <div className="strappy-fade-in mt-3 flex items-end gap-2">
            <FotoAgente nombre={nombreAgente} src={fotoAgente} size="sm" tone="ia" />
            <span className="rounded-2xl rounded-bl-sm border border-border bg-raised px-3.5 py-3">
              <IndicadorEscribiendo etiqueta={`${nombreAgente} está escribiendo`} />
            </span>
          </div>
        )}
        <div ref={final} />
      </div>

      {error && (
        <p role="alert" className="border-t border-border bg-danger-soft px-4 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}

      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviarTexto(texto);
        }}
        className="flex flex-col gap-1.5 border-t border-border p-3"
      >
        <div className="flex gap-2">
          <Input
            ref={caja}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe como lo haría un cliente…"
            aria-label="Mensaje para el agente"
            disabled={pensando}
            className="flex-1"
          />
          <Button type="submit" disabled={pensando || texto.trim().length === 0}>
            <Send size={16} aria-hidden />
            Enviar
          </Button>
        </div>
        <div className="flex items-center gap-3 px-1 text-2xs text-fg-muted">
          <span className="tnum">Saldo: {Math.round(saldo).toLocaleString("es-CO")} créditos</span>
          {ultimo && (
            <span className="tnum">
              Último turno: {ultimo.creditos} crédito{ultimo.creditos === 1 ? "" : "s"} ·{" "}
              {(ultimo.milisegundos / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} s
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

type EventoSse = { tipo: string; datos: unknown };

/** Lector mínimo de `text/event-stream`. */
async function* leerEventos(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<EventoSse> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += decodificador.decode(value, { stream: true });
    const bloques = resto.split("\n\n");
    resto = bloques.pop() ?? "";
    for (const bloque of bloques) {
      let tipo = "message";
      let datos = "";
      for (const linea of bloque.split("\n")) {
        if (linea.startsWith("event: ")) tipo = linea.slice(7).trim();
        if (linea.startsWith("data: ")) datos += linea.slice(6);
      }
      if (!datos) continue;
      yield { tipo, datos: JSON.parse(datos) as unknown };
    }
  }
}

/**
 * La cara del agente en el chat.
 *
 * Los personajes son de cuerpo entero: se enseñan enteros dentro del círculo
 * (`object-contain`) en vez de recortarlos, que les cortaría la cabeza.
 */
function FotoAgente({
  nombre,
  src,
  size = "md",
  className,
}: {
  nombre: string;
  src?: string | null | undefined;
  size?: "sm" | "md" | "lg";
  tone?: string;
  status?: string;
  className?: string;
}) {
  if (!src) return <Avatar name={nombre} size={size} tone="ia" {...(className ? { className } : {})} />;
  const lado = size === "sm" ? "size-7" : size === "lg" ? "size-10" : "size-8";
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-inset ring-1 ring-border",
        lado,
        className,
      )}
    >
      <Image src={src} alt={nombre} width={64} height={64} className="size-[115%] max-w-none object-contain" />
    </span>
  );
}
