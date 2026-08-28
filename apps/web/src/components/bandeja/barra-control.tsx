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
      <div
        data-mando={mando}
        aria-live="polite"
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5",
          "border-b border-border transition-colors duration-[var(--dur-slow)]",
          mando === "ia" && "bg-primary-soft",
          mando === "tuyo" && "border-t-2 border-t-[var(--human)] bg-human-soft",
          (mando === "otro" || mando === "pausado") && "bg-raised",
        )}
      >
        {mando === "ia" && (
          <>
            <PuntoLatiendo />
            <p className="min-w-0 flex-1 text-base text-fg">
              <span className="font-medium">La IA está atendiendo esta conversación</span>
              {hilo.conversacion.agente && (
                <span className="text-fg-secondary"> · {hilo.conversacion.agente.nombre}</span>
              )}
            </p>
            <Button variant="human" size="sm" onClick={acciones.tomar} loading={trabajando}>
              <Hand size={15} strokeWidth={1.75} aria-hidden />
              Tomar el control
              <Kbd className="ml-1 border-white/30 bg-white/15 text-white">⌘.</Kbd>
            </Button>
          </>
        )}

        {mando === "tuyo" && (
          <>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--human)] text-white">
              <UserCheck size={14} strokeWidth={2} aria-hidden />
            </span>
            <p className="min-w-0 flex-1 text-base text-fg">
              <span className="font-medium">
                Tienes el control{hilo.control.desde ? ` desde las ${hora(hilo.control.desde)}` : ""}
              </span>
              {hilo.control.quien && (
                <span className="text-fg-secondary"> · {hilo.control.quien.nombre}</span>
              )}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setAbrirDevolucion(true)}>
              <Bot size={15} strokeWidth={1.75} aria-hidden />
              Devolver a la IA
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
              size="sm"
              tone="humano"
              name={hilo.control.quien?.nombre ?? "Compañero"}
              {...(hilo.control.quien?.avatar ? { src: hilo.control.quien.avatar } : {})}
            />
            <p className="min-w-0 flex-1 text-base text-fg">
              <span className="font-medium">
                {hilo.control.quien?.nombre ?? "Otra persona"} tiene el control
              </span>
              {hilo.control.desde && (
                <span className="text-fg-secondary"> · desde las {hora(hilo.control.desde)}</span>
              )}
            </p>
            <Button variant="secondary" size="sm" onClick={acciones.solicitar} loading={trabajando}>
              Solicitar el control
            </Button>
          </>
        )}

        {mando === "pausado" && (
          <>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-hover text-fg-muted">
              <Pause size={14} strokeWidth={2} aria-hidden />
            </span>
            <p className="min-w-0 flex-1 text-base text-fg">
              <span className="font-medium">Nadie está atendiendo esta conversación</span>
              <span className="text-fg-secondary"> · la IA está en pausa</span>
            </p>
            <Button variant="human" size="sm" onClick={acciones.tomar} loading={trabajando}>
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
    <span className="relative grid size-6 shrink-0 place-items-center" aria-hidden>
      <span className="absolute size-2.5 animate-ping rounded-full bg-[var(--brand)] opacity-60 motion-reduce:animate-none" />
      <span className="relative size-2.5 rounded-full bg-[var(--brand)]" />
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
