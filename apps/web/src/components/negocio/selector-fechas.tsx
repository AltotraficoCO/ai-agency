"use client";

/**
 * Selector de periodo con atajos.
 *
 * El estado vive en la URL, no en React. Así el periodo elegido sobrevive a una
 * recarga, se puede compartir por chat con un compañero y el botón «atrás» del
 * navegador hace lo que se espera. Un `useState` aquí rompe las tres cosas.
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Popover, PopoverContent, PopoverTrigger, SegmentedControl } from "@strappy/ui";
import { ATAJOS, etiquetaDeRango, type ClaveAtajo, type RangoDias } from "@/lib/negocio/fechas";

export function SelectorFechas({ rango, atajo }: { rango: RangoDias; atajo: ClaveAtajo | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/analitica";
  const parametros = useSearchParams();
  const [desde, setDesde] = React.useState(rango.desde);
  const [hasta, setHasta] = React.useState(rango.hasta);

  function navegar(siguiente: URLSearchParams) {
    router.push(`${pathname}?${siguiente.toString()}`);
  }

  function elegirAtajo(clave: ClaveAtajo) {
    const siguiente = new URLSearchParams(parametros?.toString() ?? "");
    siguiente.set("atajo", clave);
    siguiente.delete("desde");
    siguiente.delete("hasta");
    navegar(siguiente);
  }

  function aplicarPersonalizado() {
    const siguiente = new URLSearchParams(parametros?.toString() ?? "");
    siguiente.set("desde", desde);
    siguiente.set("hasta", hasta);
    siguiente.delete("atajo");
    navegar(siguiente);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        label="Periodo"
        size="sm"
        value={(atajo ?? "personalizado") as string}
        onValueChange={(v) => elegirAtajo(v as ClaveAtajo)}
        options={ATAJOS.map((a) => ({ value: a.clave as string, label: a.etiqueta }))}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm">
            {atajo ? "Otras fechas" : etiquetaDeRango(rango)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-fg-secondary">
              Desde
              <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-secondary">
              Hasta
              <Input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
            </label>
            <Button size="sm" onClick={aplicarPersonalizado}>
              Aplicar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <span className="text-sm text-fg-muted">{etiquetaDeRango(rango)}</span>
    </div>
  );
}
