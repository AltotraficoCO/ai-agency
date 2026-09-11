"use client";

/**
 * La barra de control. La pieza más importante de la pantalla.
 *
 * Responde de un vistazo la pregunta que quien atiende se hace cien veces al
 * día: ¿esto lo está contestando el robot o lo contesto yo? Y da el botón que
 * cambia la respuesta, en el mismo sitio, sin abrir un menú.
 *
 * El color hace la mitad del trabajo: índigo cuando manda la IA, fucsia cuando
 * mandas tú, neutro cuando manda otra persona. La otra mitad la hace la frase,
 * que dice el estado en palabras porque el color solo nunca es suficiente
 * —daltonismo, brillo bajo, capturas en blanco y negro—.
 */
import * as React from "react";
import { Bot, Clock, Hand, Pause, Sparkles, UserCheck } from "lucide-react";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Kbd,
  Modal,
  ModalContent,
  Textarea,
  cn,
} from "@strappy/ui";
import type { Hilo } from "@/lib/bandeja/tipos";
import { hora } from "./formato";

export type AccionesControl = {
  tomar: () => void;
  devolver: (resumen?: string) => void;
  pausar: (minutos: number) => void;
  solicitar: () => void;
  /** Pide el resumen al modelo y devuelve el texto. */
  resumir: () => Promise<string>;
};

const PAUSAS: readonly { etiqueta: string; minutos: number }[] = [
  { etiqueta: "Pausar 30 minutos", minutos: 30 },
  { etiqueta: "Pausar 1 hora", minutos: 60 },
  { etiqueta: "Pausar 3 horas", minutos: 180 },
  { etiqueta: "Pausar hasta mañana", minutos: 60 * 16 },
];

export function BarraControl({
  hilo,
  acciones,
  trabajando,
}: {
  hilo: Hilo;
  acciones: AccionesControl;
  trabajando: boolean;
}) {
  const { mando } = hilo.conversacion;
  const [abrirDevolucion, setAbrirDevolucion] = React.useState(false);

  return (
    <>
      {/* Una tarjeta sobria con una franja de color a la izquierda: rellenar
          toda la barra de verde competía con el botón, que es lo importante. */}
      <div
        data-mando={mando}
        aria-live="polite"
        className={cn(
          "relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden px-4 py-3",
          "border-b border-border bg-raised transition-colors duration-[var(--dur-slow)]",
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:transition-colors",
          mando === "ia" && "before:bg-[var(--brand)]",
          mando === "tuyo" && "bg-human-soft before:bg-[var(--human)]",
          mando === "otro" && "before:bg-[var(--border-strong)]",
          mando === "pausado" && "before:bg-transparent",
        )}
      >
        {mando === "ia" && (
          <>
            <PuntoLatiendo />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-fg">
                La IA está atendiendo
                {hilo.conversacion.agente && (
                  <span className="font-normal text-fg-secondary"> · {hilo.conversacion.agente.nombre}</span>
                )}
              </p>
              <p className="text-sm text-fg-muted">Responde sola. Toma el control si quieres escribir tú.</p>
            </div>
            <Button variant="human" onClick={acciones.tomar} loading={trabajando}>
              <Hand size={15} strokeWidth={1.75} aria-hidden />
              Tomar el control
              <Kbd className="ml-1 hidden border-white/30 bg-white/15 text-white sm:inline-flex">⌘.</Kbd>
            </Button>
          </>
        )}

        {mando === "tuyo" && (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--human)] text-white">
              <UserCheck size={16} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-fg">
                Tienes el control{hilo.control.desde ? ` desde las ${hora(hilo.control.desde)}` : ""}
              </p>
              <p className="text-sm text-fg-secondary">
                La IA no contestará hasta que se la devuelvas
                {hilo.control.quien ? ` · ${hilo.control.quien.nombre}` : ""}.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setAbrirDevolucion(true)} loading={trabajando}>
              <Bot size={15} strokeWidth={1.75} aria-hidden />
              Devolver a la IA
              <Kbd className="ml-1 hidden sm:inline-flex">⌘.</Kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Pause size={15} strokeWidth={1.75} aria-hidden />
                  Pausar 1 h
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {PAUSAS.map((pausa) => (
                  <DropdownMenuItem key={pausa.minutos} onSelect={() => acciones.pausar(pausa.minutos)}>
                    <Clock size={15} strokeWidth={1.75} aria-hidden />
                    {pausa.etiqueta}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {mando === "otro" && (
          <>
            <Avatar
              size="md"
              tone="humano"
              name={hilo.control.quien?.nombre ?? "Compañero"}
              {...(hilo.control.quien?.avatar ? { src: hilo.control.quien.avatar } : {})}
            />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-fg">
                {hilo.control.quien?.nombre ?? "Otra persona"} tiene el control
              </p>
              <p className="text-sm text-fg-muted">
                {hilo.control.desde ? `Desde las ${hora(hilo.control.desde)}. ` : ""}Pídeselo antes de escribir.
              </p>
            </div>
            <Button variant="secondary" onClick={acciones.solicitar} loading={trabajando}>
              Solicitar el control
            </Button>
          </>
        )}

        {mando === "pausado" && (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-fg-muted">
              <Pause size={16} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-fg">Nadie está atendiendo</p>
              <p className="text-sm text-fg-muted">La IA está en pausa. Toma el control para contestar.</p>
            </div>
            <Button variant="human" onClick={acciones.tomar} loading={trabajando}>
              <Hand size={15} strokeWidth={1.75} aria-hidden />
              Tomar el control
            </Button>
          </>
        )}
      </div>

      {/* Se monta solo cuando se abre: así empieza siempre en blanco sin un
          efecto que lo limpie. */}
      {abrirDevolucion && (
        <DialogoDevolver alCerrar={() => setAbrirDevolucion(false)} acciones={acciones} />
      )}
    </>
  );
}

/** El punto que late: la IA está despierta ahora mismo, no «hace un rato». */
function PuntoLatiendo() {
  return (
    <span
      className="relative grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-fg"
      aria-hidden
    >
      <Bot size={16} strokeWidth={2} />
      <span className="absolute -right-0.5 -top-0.5 grid size-3 place-items-center">
        <span className="absolute size-3 animate-ping rounded-full bg-[var(--brand)] opacity-50 motion-reduce:animate-none" />
        <span className="relative size-2 rounded-full border border-[var(--s-raised)] bg-[var(--brand)]" />
      </span>
    </span>
  );
}

/**
 * Devolver el control, con la opción de contarle a la IA qué pasó.
 *
 * Sin esto, el agente retoma la conversación sin saber nada de los diez minutos
 * en que habló una persona: vuelve a preguntar el nombre, vuelve a ofrecer lo
 * que ya se descartó, y el cliente nota el salto. El resumen se guarda donde el
 * motor ya busca el resumen rodante, así que el próximo turno lo lee solo.
 */
function DialogoDevolver({
  alCerrar,
  acciones,
}: {
  alCerrar: () => void;
  acciones: AccionesControl;
}) {
  const [resumen, setResumen] = React.useState("");
  const [resumiendo, setResumiendo] = React.useState(false);

  const resumir = async () => {
    setResumiendo(true);
    try {
      setResumen(await acciones.resumir());
    } finally {
      setResumiendo(false);
    }
  };

  return (
    <Modal open onOpenChange={(v) => (v ? undefined : alCerrar())}>
      <ModalContent
        title="Devolver la conversación a la IA"
        description="La IA volverá a contestar en cuanto el cliente escriba. Si le dejas un resumen, retoma sabiendo lo que hablaste tú."
        footer={
          <>
            <Button variant="ghost" onClick={alCerrar}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                acciones.devolver(resumen.trim() || undefined);
                alCerrar();
              }}
            >
              Devolver el control
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 pb-2">
          <Button variant="secondary" size="sm" onClick={resumir} loading={resumiendo} className="self-start">
            <Sparkles size={15} strokeWidth={1.75} aria-hidden />
            Resumir lo que pasó para la IA
          </Button>
          <Textarea
            aria-label="Resumen para la IA"
            placeholder="Escríbelo tú, o deja que la IA lo redacte y corrígelo."
            value={resumen}
            rows={4}
            onChange={(evento) => setResumen(evento.target.value)}
          />
        </div>
      </ModalContent>
    </Modal>
  );
}
