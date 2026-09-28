"use client";

import * as React from "react";
import { Button, Input, Modal, ModalContent, Textarea } from "@strappy/ui";

/** Guardar un mensaje ya enviado como respuesta rápida reutilizable. */
export function DialogoRespuestaRapida({
  texto,
  alCerrar,
  alGuardar,
}: {
  texto: string | null;
  alCerrar: () => void;
  alGuardar: (atajo: string, titulo: string, cuerpo: string) => Promise<void>;
}) {
  // El estado se siembra del texto una sola vez: el diálogo se remonta con cada
  // mensaje que se quiera guardar (`key` en quien lo usa), así que no hace falta
  // un efecto que lo reinicie.
  const [atajo, setAtajo] = React.useState("");
  const [titulo, setTitulo] = React.useState(() => (texto ?? "").slice(0, 40));
  const [cuerpo, setCuerpo] = React.useState(texto ?? "");
  const [guardando, setGuardando] = React.useState(false);

  return (
    <Modal open={texto !== null} onOpenChange={(v) => (v ? undefined : alCerrar())}>
      <ModalContent
        title="Guardar como respuesta rápida"
        description="La podrás insertar escribiendo / en el composer. Usa {{contacto.nombre}} para que se rellene sola."
        footer={
          <>
            <Button variant="ghost" onClick={alCerrar}>
              Cancelar
            </Button>
            <Button
              loading={guardando}
              disabled={!atajo.trim() || !cuerpo.trim()}
              onClick={async () => {
                setGuardando(true);
                await alGuardar(atajo, titulo, cuerpo);
                setGuardando(false);
                alCerrar();
              }}
            >
              Guardar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base text-fg-muted">/</span>
            <Input
              value={atajo}
              onChange={(evento) => setAtajo(evento.target.value)}
              placeholder="atajo"
              aria-label="Atajo"
            />
            <Input
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
              placeholder="Título"
              aria-label="Título"
            />
          </div>
          <Textarea
            value={cuerpo}
            onChange={(evento) => setCuerpo(evento.target.value)}
            aria-label="Texto de la respuesta"
            rows={4}
          />
        </div>
      </ModalContent>
    </Modal>
  );
}
