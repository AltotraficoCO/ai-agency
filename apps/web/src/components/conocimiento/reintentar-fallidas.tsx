"use client";

/**
 * «Reintentar lo que falló».
 *
 * Solo aparece cuando hay fuentes en error. Las pone en cola de una vez y dice
 * cuántas se reintentan y cuáles necesitan algo de la persona (pegar un texto,
 * volver a subir un archivo). La pantalla se refresca sola mientras aprenden.
 */
import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button, toast } from "@strappy/ui";
import { accionReintentarFallidas } from "@/lib/conocimiento/acciones";
import { plural } from "./formato";

export function ReintentarFallidas({ cerebroId, onCambio }: { cerebroId: string; onCambio: () => void }) {
  const [enviando, setEnviando] = React.useState(false);

  const reintentar = async () => {
    setEnviando(true);
    try {
      const resultado = await accionReintentarFallidas(cerebroId);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      const { reintentadas, noSePueden } = resultado.datos;
      if (reintentadas > 0) {
        toast.success(`Volviendo a aprender ${plural(reintentadas, "fuente", "fuentes")}.`);
      }
      if (noSePueden.length > 0) {
        const primera = noSePueden[0]!;
        toast.error(
          noSePueden.length === 1
            ? `«${primera.titulo}»: ${primera.motivo}`
            : `${plural(noSePueden.length, "fuente necesita", "fuentes necesitan")} tu ayuda. Por ejemplo, «${primera.titulo}»: ${primera.motivo}`,
        );
      }
      if (reintentadas === 0 && noSePueden.length === 0) toast.success("No quedaba nada por reintentar.");
      onCambio();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Button variant="secondary" size="sm" onClick={() => void reintentar()} loading={enviando} loadingLabel="Reintentando">
      <RotateCcw size={14} aria-hidden />
      Reintentar lo que falló
    </Button>
  );
}
