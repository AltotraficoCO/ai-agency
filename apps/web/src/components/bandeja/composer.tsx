"use client";

/**
 * El composer.
 *
 * TRES COSAS QUE AQUÍ NO SE PUEDEN CONFUNDIR:
 *
 * 1. A quién le escribes. La pestaña de nota interna tiñe TODO el composer de
 *    ámbar —fondo, borde, botón y el aviso de arriba—, porque un cambio sutil
 *    de icono no basta cuando se escriben cien mensajes al día. El destino
 *    además viaja por rutas distintas del servidor: no hay un campo que
 *    invertir.
 *
 * 2. Por qué no puedes escribir. Un composer apagado sin explicación es el
 *    peor estado posible de esta pantalla: la persona cree que la aplicación
 *    está rota. Aquí el bloqueo SIEMPRE dice el motivo y ofrece la salida en el
 *    mismo sitio.
 *
 * 3. Qué dice el canal. Cuando el canal restringe el envío, su texto se pinta
 *    literal. Esta pantalla no sabe qué es una ventana de 24 horas.
 */
import * as React from "react";
import { AtSign, Hand, Lock, Send, Sparkles, StickyNote, Timer } from "lucide-react";
import { Badge, Button, Kbd, cn } from "@strappy/ui";
import type { Catalogos, Hilo, Persona, RespuestaRapida } from "@/lib/bandeja/tipos";
import { rellenarVariables } from "@/lib/bandeja/tipos";
import { cuentaAtras } from "./formato";

export type Destino = "mensaje" | "nota";

type Sugerencia =
  | { tipo: "respuesta"; opciones: RespuestaRapida[]; desde: number }
  | { tipo: "mencion"; opciones: Persona[]; desde: number };

export function Composer({
  hilo,
  catalogos,
  enviando,
  refTextarea,
  alEnviar,
  alAnotar,
  alTomarControl,
}: {
  hilo: Hilo;
  catalogos: Catalogos;
  enviando: boolean;
  refTextarea: React.RefObject<HTMLTextAreaElement | null>;
  alEnviar: (texto: string) => void;
  alAnotar: (texto: string, menciones: string[]) => void;
  alTomarControl: () => void;
}) {
  const [destino, setDestino] = React.useState<Destino>("mensaje");
  const [texto, setTexto] = React.useState("");
  // El resaltado va atado al token que se está escribiendo: al cambiar el token
  // vuelve solo a la primera opción, sin un efecto que lo reinicie.
  const [resaltado, setResaltado] = React.useState<{ token: string; indice: number }>({
    token: "",
    indice: 0,
  });
  const [menciones, setMenciones] = React.useState<string[]>([]);

  const { mando } = hilo.conversacion;
  const bloqueadoPorMando = mando !== "tuyo";
  const bloqueadoPorCanal = !hilo.envio.permitido;
  // La nota interna no va al cliente: ni el mando ni el canal la limitan.
  const bloqueado = destino === "mensaje" && (bloqueadoPorMando || bloqueadoPorCanal);

  // Al cambiar de conversación el composer se REMONTA (quien lo usa le pone
  // `key`): así el borrador de un hilo no puede aparecer en otro.
  const sugerencia = calcularSugerencia(texto, destino, catalogos);
  const tokenActual = sugerencia ? texto.slice(sugerencia.desde) : "";
  const indice = resaltado.token === tokenActual ? resaltado.indice : 0;
  const setIndice = (valor: number) => setResaltado({ token: tokenActual, indice: valor });

  const aplicarSugerencia = (posicion: number) => {
    if (!sugerencia) return;
    if (sugerencia.tipo === "respuesta") {
      const elegida = sugerencia.opciones[posicion];
      if (!elegida) return;
      const cuerpo = rellenarVariables(elegida.cuerpo, {
        "contacto.nombre": primerNombre(hilo.contacto.nombre),
        "contacto.telefono": hilo.contacto.telefono ?? "",
        "agente.nombre": catalogos.yo.nombre,
      });
      setTexto(texto.slice(0, sugerencia.desde) + cuerpo);
    } else {
      const elegida = sugerencia.opciones[posicion];
      if (!elegida) return;
      setTexto(`${texto.slice(0, sugerencia.desde)}@${elegida.nombre} `);
      setMenciones((previas) => (previas.includes(elegida.id) ? previas : [...previas, elegida.id]));
    }
    refTextarea.current?.focus();
  };

  const enviar = () => {
    const limpio = texto.trim();
    if (!limpio) return;
    if (destino === "nota") {
      alAnotar(limpio, menciones);
      setMenciones([]);
    } else {
      if (bloqueado) return;
      alEnviar(limpio);
    }
    setTexto("");
  };

  const alTeclear = (evento: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugerencia) {
      if (evento.key === "ArrowDown") {
        evento.preventDefault();
        setIndice(Math.min(indice + 1, sugerencia.opciones.length - 1));
        return;
      }
      if (evento.key === "ArrowUp") {
        evento.preventDefault();
        setIndice(Math.max(indice - 1, 0));
        return;
      }
      if (evento.key === "Enter" || evento.key === "Tab") {
        evento.preventDefault();
        aplicarSugerencia(indice);
        return;
      }
      if (evento.key === "Escape") {
        evento.preventDefault();
        setTexto(`${texto} `);
        return;
      }
    }
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      enviar();
    }
  };

  const esNota = destino === "nota";

  return (
    <div
      className={cn(
        "relative shrink-0 border-t px-4 pb-4 pt-3 transition-colors duration-[var(--dur-base)]",
        // El ámbar tiene que verse a un metro de la pantalla: el `soft` solo
        // no se distingue del fondo en el tema oscuro.
        esNota
          ? "border-t-2 border-t-[var(--warning)] bg-[color-mix(in_oklab,var(--warning),var(--s-page)_86%)]"
          : "border-t-border bg-page",
      )}
    >
      <div className="mb-2 flex items-center gap-1">
        <PestanaComposer activa={!esNota} onClick={() => setDestino("mensaje")} tono="mensaje">
          <Send size={14} strokeWidth={1.75} aria-hidden />
          Responder al cliente
        </PestanaComposer>
        <PestanaComposer activa={esNota} onClick={() => setDestino("nota")} tono="nota">
          <StickyNote size={14} strokeWidth={1.75} aria-hidden />
          Nota interna
        </PestanaComposer>

        <div className="ml-auto flex items-center gap-2">
          <VentanaDeEnvio hilo={hilo} />
        </div>
      </div>

      {esNota && (
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--warning-fg)]">
          <StickyNote size={14} strokeWidth={2} aria-hidden />
          Esto NO le llega al cliente. Solo lo ve tu equipo.
        </p>
      )}

      {/* Sobre el composer entero, no dentro: colgada del cuadro de texto,
          tapaba las pestañas y el aviso de nota interna. */}
      {sugerencia && (
        <ListaSugerencias
          sugerencia={sugerencia}
          indice={indice}
          alElegir={aplicarSugerencia}
          alSeñalar={setIndice}
        />
      )}

      <div className="relative">
        <textarea
          ref={refTextarea}
          value={texto}
          rows={2}
          disabled={bloqueado}
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={alTeclear}
          aria-label={esNota ? "Nota interna" : "Mensaje para el cliente"}
          placeholder={
            esNota
              ? "Escribe una nota para tu equipo. Usa @ para mencionar a alguien."
              : "Escribe tu respuesta. Usa / para insertar una respuesta rápida."
          }
          className={cn(
            "w-full resize-none rounded-2xl border bg-raised px-4 py-3 text-md text-fg outline-none",
            "placeholder:text-fg-muted transition-colors duration-[var(--dur-instant)]",
            "disabled:cursor-not-allowed disabled:opacity-60",
            esNota
              ? "border-[var(--warning)] bg-[color-mix(in_oklab,var(--warning-soft),var(--s-raised)_35%)] focus:border-[var(--warning)] focus:ring-2 focus:ring-[var(--warning)]/35"
              : "border-[color-mix(in_oklab,var(--human),transparent_55%)] focus:border-[var(--human)] focus:ring-2 focus:ring-[var(--human)]/30",
          )}
        />

        <div className="mt-2 flex items-center gap-2">
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Kbd>Enter</Kbd> envía · <Kbd>Mayús</Kbd>+<Kbd>Enter</Kbd> salto de línea
            {esNota ? (
              <>
                {" "}
                · <AtSign size={12} aria-hidden /> menciona
              </>
            ) : (
              <>
                {" "}
                · <Kbd>/</Kbd> respuestas rápidas
              </>
            )}
          </p>
          <Button
            className="ml-auto"
            size="sm"
            variant={esNota ? "secondary" : "human"}
            onClick={enviar}
            loading={enviando}
            disabled={!texto.trim() || (bloqueado && !esNota)}
          >
            {esNota ? (
              <>
                <StickyNote size={15} strokeWidth={1.75} aria-hidden />
                Guardar la nota
              </>
            ) : (
              <>
                <Send size={15} strokeWidth={1.75} aria-hidden />
                Enviar
              </>
            )}
          </Button>
        </div>
      </div>

      {bloqueado && (
        <VeloDeBloqueo
          motivo={bloqueadoPorMando ? "mando" : "canal"}
          hilo={hilo}
          alTomarControl={alTomarControl}
          alAnotar={() => {
            setDestino("nota");
            window.setTimeout(() => refTextarea.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
}

function PestanaComposer({
  activa,
  onClick,
  tono,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  tono: "mensaje" | "nota";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        activa && tono === "mensaje" && "bg-human-soft text-human-fg",
        activa && tono === "nota" && "bg-[var(--warning)] text-[var(--fg-inverse)]",
        !activa && "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * El contador vivo de la ventana de envío.
 *
 * Cuenta el tiempo que falta hasta el instante que dio el CANAL. Qué significa
 * ese instante —y qué se puede hacer cuando llegue— lo dice el canal, no esta
 * función: por eso aquí no hay ni la palabra «plantilla» ni el número 24.
 */
function VentanaDeEnvio({ hilo }: { hilo: Hilo }) {
  const hasta = hilo.conversacion.envioLibreHasta;
  const [ahora, setAhora] = React.useState(() => new Date());

  React.useEffect(() => {
    const t = window.setInterval(() => setAhora(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (!hasta || !hilo.envio.permitido) return null;
  const { texto, minutos } = cuentaAtras(hasta, ahora);
  if (minutos <= 0) return null;

  const apremia = minutos < 120;
  return (
    <Badge tone={apremia ? "aviso" : "neutral"} title={`Puedes escribir libremente durante ${texto}`}>
      <Timer size={12} strokeWidth={2} aria-hidden />
      <span className="tnum">Quedan {texto}</span>
    </Badge>
  );
}

/**
 * El velo que explica por qué no puedes escribir.
 *
 * Nunca un composer muerto y mudo: motivo, y la salida al lado.
 */
function VeloDeBloqueo({
  motivo,
  hilo,
  alTomarControl,
  alAnotar,
}: {
  motivo: "mando" | "canal";
  hilo: Hilo;
  alTomarControl: () => void;
  alAnotar: () => void;
}) {
  const { mando } = hilo.conversacion;
  const restriccion = hilo.envio.restriccion;

  return (
    <div
      className={cn(
        // Opaco, no translúcido: dejar que el composta de debajo se lea a
        // medias hace pensar que la pantalla se rompió a mitad de pintado.
        "absolute inset-x-4 bottom-4 top-11 z-10 flex flex-col justify-center gap-3 rounded-2xl",
        "border border-border bg-raised px-4 py-3 shadow-e1",
      )}
    >
      {motivo === "mando" && mando === "ia" && (
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles size={18} strokeWidth={1.75} className="shrink-0 text-primary-fg" aria-hidden />
          <p className="min-w-0 flex-1 text-base text-fg-secondary">
            <span className="font-medium text-fg">La IA está atendiendo esta conversación.</span>{" "}
            Toma el control para escribirle tú al cliente.
          </p>
          <Button size="sm" variant="human" onClick={alTomarControl}>
            <Hand size={15} strokeWidth={1.75} aria-hidden />
            Tomar el control
          </Button>
          <Button size="sm" variant="ghost" onClick={alAnotar}>
            Dejar una nota
          </Button>
        </div>
      )}

      {motivo === "mando" && mando === "otro" && (
        <div className="flex flex-wrap items-center gap-3">
          <Lock size={18} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
          <p className="min-w-0 flex-1 text-base text-fg-secondary">
            <span className="font-medium text-fg">
              {hilo.control.quien?.nombre ?? "Otra persona"} tiene el control.
            </span>{" "}
            No escribas encima: pídeselo o deja una nota.
          </p>
          <Button size="sm" variant="ghost" onClick={alAnotar}>
            Dejar una nota
          </Button>
        </div>
      )}

      {motivo === "mando" && mando === "pausado" && (
        <div className="flex flex-wrap items-center gap-3">
          <Lock size={18} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
          <p className="min-w-0 flex-1 text-base text-fg-secondary">
            Nadie tiene el control de esta conversación. Tómalo para escribir.
          </p>
          <Button size="sm" variant="human" onClick={alTomarControl}>
            <Hand size={15} strokeWidth={1.75} aria-hidden />
            Tomar el control
          </Button>
        </div>
      )}

      {motivo === "canal" && restriccion && <SelectorDePlantillas restriccion={restriccion} alAnotar={alAnotar} />}
    </div>
  );
}

/**
 * Lo que queda cuando el canal cierra el envío libre.
 *
 * El texto de arriba es del canal, palabra por palabra. Lo único que pone esta
 * pantalla es el camino a seguir con la alternativa que el propio canal
 * declara.
 */
function SelectorDePlantillas({
  restriccion,
  alAnotar,
}: {
  restriccion: NonNullable<Hilo["envio"]["restriccion"]>;
  alAnotar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-2 text-base text-fg">
        <Lock size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" aria-hidden />
        {/* Literal. Lo escribe el canal, no la bandeja. */}
        <span>{restriccion.mensaje}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          disabled
          aria-label={restriccion.alternativa?.etiqueta ?? "Plantillas aprobadas"}
          className="h-9 min-w-[16rem] rounded-md border border-border bg-raised px-3 text-base text-fg-muted"
        >
          <option>Todavía no hay plantillas aprobadas sincronizadas</option>
        </select>
        {restriccion.alternativa && (
          <Button size="sm" variant="secondary" disabled>
            {restriccion.alternativa.etiqueta}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={alAnotar}>
          Dejar una nota
        </Button>
      </div>
    </div>
  );
}

function ListaSugerencias({
  sugerencia,
  indice,
  alElegir,
  alSeñalar,
}: {
  sugerencia: Sugerencia;
  indice: number;
  alElegir: (posicion: number) => void;
  alSeñalar: (posicion: number) => void;
}) {
  return (
    <ul
      role="listbox"
      aria-label={sugerencia.tipo === "respuesta" ? "Respuestas rápidas" : "Compañeros"}
      className="absolute inset-x-4 bottom-full z-20 mb-2 max-h-64 overflow-auto rounded-lg border border-border bg-overlay p-1 shadow-e3"
    >
      {sugerencia.opciones.length === 0 && (
        <li className="px-3 py-2 text-sm text-fg-muted">
          {sugerencia.tipo === "respuesta"
            ? "Ninguna respuesta rápida coincide."
            : "Nadie coincide con eso."}
        </li>
      )}
      {sugerencia.opciones.map((opcion, posicion) => {
        const activa = posicion === indice;
        return (
          <li key={"atajo" in opcion ? opcion.id : opcion.id}>
            <button
              type="button"
              role="option"
              aria-selected={activa}
              onMouseEnter={() => alSeñalar(posicion)}
              onClick={() => alElegir(posicion)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left",
                activa ? "bg-selected" : "hover:bg-hover",
              )}
            >
              {"atajo" in opcion ? (
                <>
                  <span className="flex items-center gap-2 text-base font-medium text-fg">
                    <span className="font-mono text-sm text-primary-fg">/{opcion.atajo}</span>
                    {opcion.titulo}
                  </span>
                  <span className="line-clamp-1 text-sm text-fg-muted">{opcion.cuerpo}</span>
                </>
              ) : (
                <span className="text-base text-fg">{opcion.nombre}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** ¿El cursor está escribiendo un `/atajo` o una `@mención`? */
export function calcularSugerencia(
  texto: string,
  destino: Destino,
  catalogos: Catalogos,
): Sugerencia | null {
  const separador = Math.max(texto.lastIndexOf(" "), texto.lastIndexOf("\n"));
  const token = texto.slice(separador + 1);

  if (destino === "mensaje" && token.startsWith("/")) {
    const consulta = token.slice(1).toLowerCase();
    return {
      tipo: "respuesta",
      desde: separador + 1,
      opciones: catalogos.respuestas.filter(
        (r) =>
          r.atajo.toLowerCase().includes(consulta) ||
          r.titulo.toLowerCase().includes(consulta),
      ) as RespuestaRapida[],
    };
  }

  if (destino === "nota" && token.startsWith("@")) {
    const consulta = token.slice(1).toLowerCase();
    return {
      tipo: "mencion",
      desde: separador + 1,
      opciones: catalogos.miembros.filter((m) => m.nombre.toLowerCase().includes(consulta)) as Persona[],
    };
  }

  return null;
}

function primerNombre(nombre: string): string {
  return nombre.split(" ")[0] ?? nombre;
}
