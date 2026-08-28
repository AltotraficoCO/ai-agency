"use client";

/**
 * El simulador.
 *
 * No es una maqueta: cada mensaje pasa por el motor real, se guarda en
 * `messages` y descuenta créditos de `credit_wallets`. Por eso la barra de
 * abajo enseña los créditos que costó ESTE turno: probar cuesta dinero y
 * ocultarlo sería mentir sobre el producto.
 */
import * as React from "react";
import { RotateCcw, Send } from "lucide-react";
import { Avatar, Badge, Button, Input, Spinner } from "@strappy/ui";

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

export function SimuladorChat({
  agentId,
  conversationId,
  historial,
  nombreAgente,
  saldoInicial,
  modeloDeEnsayo,
}: SimuladorChatProps) {
  const [mensajes, setMensajes] = React.useState<MensajeVista[]>(historial);
  const [texto, setTexto] = React.useState("");
  const [pensando, setPensando] = React.useState(false);
  const [ultimo, setUltimo] = React.useState<Resultado | null>(null);
  const [saldo, setSaldo] = React.useState(saldoInicial);
  const [error, setError] = React.useState<string | null>(null);
  const final = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, pensando]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const limpio = texto.trim();
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
    }
  }

  async function reiniciar() {
    await fetch(`/api/agentes/${agentId}/simulador/reiniciar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    setMensajes([]);
    setUltimo(null);
    setError(null);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Badge tone="ia">Simulador</Badge>
        <span className="text-sm text-fg-secondary">
          Nadie de fuera recibe estos mensajes, pero todo lo demás es real.
        </span>
        {modeloDeEnsayo && (
          <Badge tone="aviso" title="No hay AI_GATEWAY_API_KEY configurada">
            Modelo de ensayo
          </Badge>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={reiniciar}>
          <RotateCcw size={16} aria-hidden />
          Empezar de nuevo
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {mensajes.length === 0 && !pensando && (
          <p className="mx-auto max-w-md py-12 text-center text-base text-fg-secondary">
            Escríbele como si fueras un cliente. {nombreAgente} responderá con las instrucciones
            que le diste.
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {mensajes.map((m) => (
            <li
              key={m.id}
              className={m.autor === "contacto" ? "flex justify-end" : "flex justify-start"}
            >
              {m.autor === "sistema" ? (
                <p className="mx-auto max-w-md rounded-md bg-hover px-3 py-1.5 text-center text-2xs text-fg-muted">
                  {m.texto}
                </p>
              ) : (
                <div className="flex max-w-[80%] items-end gap-2">
                  {m.autor === "agente" && (
                    <Avatar name={nombreAgente} size="sm" tone="ia" />
                  )}
                  <p
                    className={
                      m.autor === "contacto"
                        ? "rounded-2xl rounded-br-sm bg-raised px-3.5 py-2 text-base text-fg border border-border"
                        : "rounded-2xl rounded-bl-sm bg-primary-soft px-3.5 py-2 text-base text-primary-fg"
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
          <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
            <Spinner size="sm" label="Pensando" />
            {nombreAgente} está pensando…
          </p>
        )}
        <div ref={final} />
      </div>

      {error && (
        <p className="border-t border-border bg-danger-soft px-4 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-2xs text-fg-muted">
        <span className="tnum">Saldo: {Math.round(saldo).toLocaleString("es-CO")} créditos</span>
        {ultimo && (
          <span className="tnum">
            Último turno: {ultimo.creditos} crédito{ultimo.creditos === 1 ? "" : "s"} ·{" "}
            {ultimo.pasos} paso{ultimo.pasos === 1 ? "" : "s"} · {ultimo.milisegundos} ms
          </span>
        )}
      </div>

      <form onSubmit={enviar} className="flex gap-2 border-t border-border p-3">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Hola, ¿a qué hora abren hoy?"
          aria-label="Mensaje para el agente"
          disabled={pensando}
          className="flex-1"
        />
        <Button type="submit" disabled={pensando || texto.trim().length === 0}>
          <Send size={16} aria-hidden />
          Enviar
        </Button>
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
