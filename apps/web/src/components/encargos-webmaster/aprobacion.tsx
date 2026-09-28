"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@strappy/ui";
import { TextoStrap } from "@/components/meta/texto-strap";
import type { AprobacionVista } from "@/lib/encargos/encargos";
import type { Acciones } from "./comun";

export function Aprobacion({
  aprobacion,
  decidir,
  onError,
}: {
  aprobacion: AprobacionVista;
  decidir: Acciones["decidir"];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [decidiendo, setDecidiendo] = React.useState<boolean | null>(null);

  async function responderCon(aprobada: boolean) {
    setDecidiendo(aprobada);
    onError(null);
    const resultado = await decidir(aprobacion.id, aprobada);
    setDecidiendo(null);
    if (resultado.ok) router.refresh();
    else onError(resultado.error);
  }

  return (
    <div className="strappy-pop-in flex flex-col gap-3 rounded-xl border-2 border-[var(--border-subtle)] border-l-4 border-l-warning bg-inset px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warning-fg">
        <ShieldAlert size={16} aria-hidden />
        Necesito tu aprobación
      </p>
      <TextoStrap texto={aprobacion.resumen} />
      <p className="text-sm text-fg-muted">Te lo pregunto porque {aprobacion.motivo}.</p>
      <div className="flex flex-wrap gap-2">
        <Button loading={decidiendo === true} disabled={decidiendo !== null} onClick={() => responderCon(true)}>
          Aprobar y seguir
        </Button>
        <Button
          variant="secondary"
          loading={decidiendo === false}
          disabled={decidiendo !== null}
          onClick={() => responderCon(false)}
        >
          No, déjalo así
        </Button>
      </div>
    </div>
  );
}
