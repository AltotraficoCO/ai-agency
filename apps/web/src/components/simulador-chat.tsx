"use client";

/**
 * El simulador.
 *
 * No es una maqueta: cada mensaje pasa por el motor real, se guarda en
 * `messages` y descuenta créditos de `credit_wallets`. Por eso la barra de
 * abajo enseña los créditos que costó ESTE turno: probar cuesta dinero y
 * ocultarlo sería mentir sobre el producto.
 *
 * Se ve y se comporta como los encargos al Webmaster: a la izquierda el
 * historial de pruebas, arriba la foto del agente que late mientras responde, y
 * bajo cada respuesta el registro de lo que hizo antes de contestar —buscar en
 * el conocimiento, guardar un dato, pasar con el equipo—. Abierto mientras
 * trabaja, recogido al terminar.
 *
 * Arranca con sugerencias pulsables: frente a una caja vacía nadie sabe qué
 * escribirle a su propio agente, y el primer mensaje es el que más cuesta.
 */
import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FlaskConical, Send } from "lucide-react";
import { Badge, Button, IndicadorEscribiendo, Textarea, cn } from "@strappy/ui";
import { PanelHistorial, type ItemHistorial } from "@/components/conversacion/panel-historial";
import { RegistroTrabajo, type PasoVista } from "@/components/conversacion/registro-trabajo";
import { horaCorta } from "@/components/conversacion/tiempo";

export type MensajeVista = {
  id: string;
  autor: "contacto" | "agente" | "sistema";
  texto: string;
  fecha: string;
  /** Lo que hizo el agente antes de escribir este mensaje. */
  pasos?: readonly PasoVista[];
};

export type SesionVista = {
  id: string;
  titulo: string;
  fecha: string;
  mensajes: number;
};

export interface SimuladorChatProps {
  agentId: string;
  conversationId: string;
  historial: MensajeVista[];
  /** Las pruebas de este agente, la más reciente primero. */
  sesiones: SesionVista[];
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
  trabajo?: PasoVista[];
  saldo: number;
  milisegundos: number;
};

/** Un mensaje en pantalla. `pendiente` es la respuesta que aún se está pensando. */
type Burbuja = MensajeVista & { pendiente?: boolean };

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
  sesiones,
  nombreAgente,
  fotoAgente,
  saldoInicial,
  modeloDeEnsayo,
}: SimuladorChatProps) {
  const router = useRouter();
  const [mensajes, setMensajes] = React.useState<Burbuja[]>(historial);
  const [texto, setTexto] = React.useState("");
  const [pensando, setPensando] = React.useState(false);
  const [ultimo, setUltimo] = React.useState<Resultado | null>(null);
  const [saldo, setSaldo] = React.useState(saldoInicial);
  const [error, setError] = React.useState<string | null>(null);
  const final = React.useRef<HTMLDivElement>(null);
  const caja = React.useRef<HTMLTextAreaElement>(null);
  const turnos = React.useRef(0);

  React.useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  function cambiarTurno(id: string, cambio: (m: Burbuja) => Burbuja | null) {
    setMensajes((previos) =>
      previos.flatMap((m) => {
        if (m.id !== id) return [m];
        const nuevo = cambio(m);
        return nuevo ? [nuevo] : [];
      }),
    );
  }

  async function enviarTexto(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || pensando) return;

    // La respuesta ocupa su sitio desde el principio, con la misma clave de
    // principio a fin: así el registro de trabajo se recoge con animación en
    // vez de cambiarse por otro.
    turnos.current += 1;
    const idTurno = `turno-${turnos.current}`;
    setTexto("");
    setError(null);
    setMensajes((previos) => {
      const ahora = new Date().toISOString();
      return [
        ...previos,
        { id: `${idTurno}-cliente`, autor: "contacto", texto: limpio, fecha: ahora },
        { id: idTurno, autor: "agente", texto: "", fecha: ahora, pasos: [], pendiente: true },
      ];
    });
    setPensando(true);

    try {
      const respuesta = await fetch(`/api/agentes/${agentId}/simulador`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, texto: limpio }),
      });
      if (!respuesta.body) throw new Error("El servidor no devolvió ningún flujo.");

      for await (const evento of leerEventos(respuesta.body)) {
        if (evento.tipo === "paso") {
          const paso = evento.datos as PasoVista;
          cambiarTurno(idTurno, (m) => ({ ...m, pasos: [...(m.pasos ?? []), paso] }));
        }
        if (evento.tipo === "resultado") {
          const r = evento.datos as Resultado;
          setUltimo(r);
          setSaldo(r.saldo);
          const fecha = new Date().toISOString();
          cambiarTurno(idTurno, (m) =>
            r.respuesta
              ? { ...m, texto: r.respuesta, fecha, pasos: r.trabajo ?? m.pasos ?? [], pendiente: false }
              : r.motivo
                ? { id: idTurno, autor: "sistema", texto: r.motivo, fecha }
                : null,
          );
        }
        if (evento.tipo === "error") {
          setError((evento.datos as { mensaje: string }).mensaje);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo hablar con el simulador.");
    } finally {
      // Si el flujo se cortó sin resultado, no se queda una respuesta fantasma.
      cambiarTurno(idTurno, (m) => (m.pendiente ? null : m));
      setPensando(false);
      // El historial de la izquierda cambia de título, fecha y cuenta.
      router.refresh();
      requestAnimationFrame(() => caja.current?.focus());
    }
  }

  async function nuevaPrueba() {
    if (pensando) return;
    if (mensajes.length === 0) {
      caja.current?.focus();
      return;
    }
    setError(null);
    try {
      const respuesta = await fetch(`/api/agentes/${agentId}/simulador/sesiones`, { method: "POST" });
      const datos = (await respuesta.json()) as { id?: string; error?: string };
      if (!respuesta.ok || !datos.id) throw new Error(datos.error ?? "No se pudo empezar otra prueba.");
      if (datos.id === conversationId) {
        // Esta prueba no llegó a guardarse (el turno falló): se reutiliza en limpio.
        setMensajes([]);
        setUltimo(null);
        router.refresh();
        return;
      }
      router.push(`/agentes/${agentId}/probar?conversacion=${datos.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo empezar otra prueba.");
    }
  }

  const enPantalla = mensajes.filter((m) => !m.pendiente).length;
  const primeroLocal = mensajes.find((m) => m.autor === "contacto")?.texto;

  const items: ItemHistorial[] = sesiones.map((sesion) => {
    const actual = sesion.id === conversationId;
    const cuenta = actual ? Math.max(sesion.mensajes, enPantalla) : sesion.mensajes;
    return {
      id: sesion.id,
      // La prueba en curso estrena título en cuanto sale el primer mensaje,
      // sin esperar a que el servidor lo confirme.
      titulo: actual && sesion.mensajes === 0 && primeroLocal ? primeroLocal : sesion.titulo,
      fecha: sesion.fecha,
      estado:
        actual && pensando
          ? { texto: "Respondiendo", tono: "ia", vivo: true }
          : { texto: cuenta === 0 ? "Sin mensajes" : `${cuenta} ${cuenta === 1 ? "mensaje" : "mensajes"}`, tono: "neutral" },
      ...(actual ? {} : { href: `/agentes/${agentId}/probar?conversacion=${sesion.id}` }),
    };
  });

  const vacio = mensajes.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <PanelHistorial
        titulo="Pruebas"
        items={items}
        activoId={conversationId}
        onElegir={() => caja.current?.focus()}
        claveAlmacen="strappy-historial-pruebas"
        vacio="Aquí aparecerán tus conversaciones de prueba."
        nuevo={{ etiqueta: "Nueva prueba", onClick: () => void nuevaPrueba() }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* ── Con quién hablas ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-b-2 border-[var(--border-subtle)]">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-3">
            <FotoAgente nombre={nombreAgente} src={fotoAgente} size={44} activo={pensando} />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate font-display text-base font-semibold text-fg">{nombreAgente}</p>
              <p className="truncate text-2xs text-fg-muted">Nadie de fuera recibe estos mensajes</p>
            </div>
            {modeloDeEnsayo && (
              <Badge tone="aviso" title="No hay AI_GATEWAY_API_KEY configurada" className="hidden sm:inline-flex">
                Modelo de ensayo
              </Badge>
            )}
            {pensando ? (
              <span className="strappy-pop-in inline-flex shrink-0 items-center gap-2 rounded-full border-2 border-[color-mix(in_oklab,var(--brand),transparent_60%)] bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-fg">
                <IndicadorEscribiendo etiqueta={`${nombreAgente} está respondiendo`} />
                Respondiendo…
              </span>
            ) : (
              <Badge tone="ia" className="shrink-0">
                <FlaskConical aria-hidden />
                Modo prueba
              </Badge>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
            {vacio && (
              <div className="strappy-slide-up flex flex-col items-center gap-4 py-10 text-center">
                <FotoAgente nombre={nombreAgente} src={fotoAgente} size={112} activo={false} />
                <div className="flex flex-col gap-1">
                  <p className="font-display text-xl font-semibold text-fg">Háblale como si fueras un cliente</p>
                  <p className="max-w-[52ch] text-base text-fg-secondary">
                    {nombreAgente} responde con sus instrucciones y lo que sabe de tu negocio. Verás qué hizo
                    antes de contestar. Empieza por una de estas o escribe la tuya.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGERENCIAS.map((sugerencia) => (
                    <button
                      key={sugerencia}
                      type="button"
                      onClick={() => void enviarTexto(sugerencia)}
                      className="cursor-pointer rounded-full border-2 border-border bg-raised px-3.5 py-2 text-sm text-fg-secondary shadow-e1 transition-[color,border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg active:scale-95"
                    >
                      {sugerencia}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ol className="flex flex-col gap-5">
              {mensajes.map((mensaje) => (
                <Mensaje key={mensaje.id} mensaje={mensaje} nombreAgente={nombreAgente} fotoAgente={fotoAgente} />
              ))}
            </ol>
            <div ref={final} />
          </div>
        </div>

        {/* ── Composer ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t-2 border-[var(--border-subtle)] bg-page">
          <form
            onSubmit={(evento) => {
              evento.preventDefault();
              void enviarTexto(texto);
            }}
            className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-4"
          >
            <div className="flex items-end gap-2 rounded-2xl border-2 border-border bg-raised p-2 shadow-e1 transition-colors focus-within:border-[color-mix(in_oklab,var(--brand),transparent_45%)]">
              <Textarea
                ref={caja}
                rows={2}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Enter envía; Mayús+Enter hace salto de línea, como en cualquier chat.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void enviarTexto(texto);
                  }
                }}
                disabled={pensando}
                placeholder="Escribe como lo haría un cliente…"
                aria-label="Mensaje para el agente"
                className="min-h-12 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:outline-none"
              />
              <Button
                type="submit"
                loading={pensando}
                loadingLabel="Respondiendo"
                disabled={!texto.trim()}
                aria-label="Enviar"
              >
                <Send size={16} aria-hidden />
                Enviar
              </Button>
            </div>
            {error && (
              <p role="alert" className="px-1 text-sm text-danger-fg">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-2xs text-fg-muted">
              <span className="tnum">Saldo: {Math.round(saldo).toLocaleString("es-CO")} créditos</span>
              {ultimo && (
                <span className="tnum">
                  Último turno: {ultimo.creditos} crédito{ultimo.creditos === 1 ? "" : "s"} ·{" "}
                  {(ultimo.milisegundos / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} s
                </span>
              )}
              <span className="ml-auto hidden sm:inline">Enter para enviar · Mayús+Enter para otra línea</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Mensaje({
  mensaje,
  nombreAgente,
  fotoAgente,
}: {
  mensaje: Burbuja;
  nombreAgente: string;
  fotoAgente: string | null | undefined;
}) {
  if (mensaje.autor === "contacto") {
    return (
      <li className="strappy-slide-up flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-selected px-4 py-2.5 text-md text-fg shadow-e1">
          {mensaje.texto}
        </div>
      </li>
    );
  }

  if (mensaje.autor === "sistema") {
    return (
      <li className="strappy-slide-up flex justify-center">
        <p className="max-w-md rounded-full border-2 border-[var(--border-subtle)] bg-inset px-3 py-1.5 text-center text-2xs text-fg-muted">
          {mensaje.texto}
        </p>
      </li>
    );
  }

  const pendiente = mensaje.pendiente === true;
  const pasos = mensaje.pasos ?? [];

  return (
    <li className="strappy-slide-up flex items-start gap-2.5">
      <span className="mt-1">
        <FotoAgente nombre={nombreAgente} src={fotoAgente} size={32} activo={pendiente} />
      </span>
      {/* La IA habla en neutro con borde; el verde sobre verde cansaba la vista. */}
      <div className="flex min-w-0 max-w-[88%] flex-1 flex-col gap-3 rounded-2xl rounded-tl-md border-2 border-[var(--border-subtle)] bg-raised px-4 py-3 shadow-e1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{nombreAgente}</span>
          {!pendiente && pasos.length === 0 ? (
            <span className="text-2xs text-fg-muted">· Respondió directamente</span>
          ) : null}
          <time suppressHydrationWarning dateTime={mensaje.fecha} className="tnum ml-auto text-2xs text-fg-muted">
            {horaCorta(mensaje.fecha)}
          </time>
        </div>

        <RegistroTrabajo pasos={pasos} activo={pendiente} textoActivo="Pensando la respuesta…" />

        {pendiente ? (
          <span className="py-1">
            <IndicadorEscribiendo etiqueta={`${nombreAgente} está escribiendo`} />
          </span>
        ) : (
          <p className="whitespace-pre-wrap text-md text-fg">{mensaje.texto}</p>
        )}
      </div>
    </li>
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
 * La cara del agente, en círculo como la del Webmaster.
 *
 * Los personajes son de cuerpo entero: se amplían y se suben para que el
 * círculo enseñe la cara. Mientras responde, un aro verde late alrededor.
 */
function FotoAgente({
  nombre,
  src,
  size,
  activo,
}: {
  nombre: string;
  src: string | null | undefined;
  size: number;
  activo: boolean;
}) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {activo ? (
        <span
          aria-hidden
          className="absolute -inset-1 animate-ping rounded-full border-2 border-primary/60 motion-reduce:animate-none"
        />
      ) : null}
      <span
        className={cn(
          "relative size-full overflow-hidden rounded-full border-2 bg-[radial-gradient(circle_at_50%_30%,#123a3a_0%,#0b2224_75%)] shadow-e2",
          activo ? "border-primary" : "border-[var(--border-default)]",
        )}
      >
        {src ? (
          <Image
            src={src}
            alt=""
            width={size * 3}
            height={size * 3}
            className="absolute left-1/2 top-[4%] h-auto w-[150%] max-w-none -translate-x-1/2"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-full place-items-center font-display font-semibold text-primary-fg"
            style={{ fontSize: Math.round(size * 0.38) }}
          >
            {iniciales(nombre)}
          </span>
        )}
      </span>
    </span>
  );
}

function iniciales(nombre: string): string {
  return (
    nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join("") || "?"
  );
}
