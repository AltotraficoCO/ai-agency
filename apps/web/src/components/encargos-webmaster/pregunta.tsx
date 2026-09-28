"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";
import { Button, IndicadorEscribiendo, Input } from "@strappy/ui";
import { TextoStrap } from "@/components/meta/texto-strap";
import type { AprobacionVista } from "@/lib/encargos/encargos";
import type { Acciones } from "./comun";

export function Pregunta({
  aprobacion,
  responder,
  onError,
}: {
  aprobacion: AprobacionVista;
  responder: Acciones["responder"];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [texto, setTexto] = React.useState("");

  async function enviar(respuesta: string) {
    const limpia = respuesta.trim();
    if (!limpia) return;
    setEnviando(limpia);
    onError(null);
    const resultado = await responder(aprobacion.id, limpia);
    setEnviando(null);
    if (resultado.ok) router.refresh();
    else onError(resultado.error);
  }

  return (
    <div className="strappy-pop-in flex flex-col gap-3 rounded-xl border-2 border-[var(--border-subtle)] border-l-4 border-l-primary bg-inset px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary-fg">
        <MessageCircleQuestion size={16} aria-hidden />
        Tengo una pregunta
      </p>
      <TextoStrap texto={aprobacion.resumen} />
      {aprobacion.opciones.length > 0 && (
        <div className="flex flex-col gap-2">
          {aprobacion.opciones.map((opcion) => (
            <button
              key={opcion}
              type="button"
              disabled={enviando !== null}
              onClick={() => void enviar(opcion)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border-2 border-border bg-raised px-3 py-2.5 text-left text-base text-fg shadow-e1 transition-[border-color,background-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:bg-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opcion}
              {enviando === opcion ? <IndicadorEscribiendo etiqueta="Enviando" /> : null}
            </button>
          ))}
        </div>
      )}
      {aprobacion.permiteTexto && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(texto);
          }}
        >
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={aprobacion.opciones.length > 0 ? "…o escribe otra respuesta" : "Escribe tu respuesta"}
            aria-label={aprobacion.resumen}
            disabled={enviando !== null}
            maxLength={1000}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={enviando !== null && enviando === texto.trim()}
            disabled={enviando !== null || !texto.trim()}
          >
            Responder
          </Button>
        </form>
      )}
    </div>
  );
}
