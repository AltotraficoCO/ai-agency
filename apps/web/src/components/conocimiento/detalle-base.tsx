"use client";

/**
 * El detalle de una base de conocimiento.
 *
 * A la izquierda, el trabajo: añadir conocimiento y ver las fuentes. A la
 * derecha, para qué sirve: qué agentes la usan y probar qué encontrarían.
 *
 * Mientras alguna fuente aprende, la pantalla se refresca sola cada pocos
 * segundos. Nadie debería tener que recargar para saber si ya terminó.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Bot, Layers } from "lucide-react";
import { EncabezadoPagina, Spinner } from "@strappy/ui";
import type { FichaCerebro } from "@/lib/conocimiento/tipos";
import { AnadirConocimiento } from "./anadir-conocimiento";
import { plural } from "./formato";
import { ListaFuentes } from "./lista-fuentes";
import { PanelAgentes } from "./panel-agentes";
import { Pruebalo } from "./pruebalo";

const INTERVALO_MS = 3000;

export function DetalleBase({ ficha }: { ficha: FichaCerebro }) {
  const router = useRouter();
  const aprendiendo =
    ficha.aprendiendo > 0 ||
    ficha.fuentesDetalle.some((f) => f.estado === "pendiente" || f.estado === "aprendiendo");

  React.useEffect(() => {
    if (!aprendiendo) return;
    const temporizador = window.setInterval(() => router.refresh(), INTERVALO_MS);
    return () => window.clearInterval(temporizador);
  }, [aprendiendo, router]);

  const refrescar = React.useCallback(() => router.refresh(), [router]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <EncabezadoPagina
        titulo={ficha.nombre}
        descripcion={ficha.descripcion ?? "Lo que añadas aquí lo sabrán los agentes que conectes."}
        icono={
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-fg">
            <BookOpen size={20} strokeWidth={1.9} aria-hidden />
          </span>
        }
      />

      <div className="strappy-slide-up flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
        <Dato icono={<Layers size={14} aria-hidden />} texto={plural(ficha.fuentes, "fuente", "fuentes")} />
        <Dato icono={<BookOpen size={14} aria-hidden />} texto={plural(ficha.fragmentos, "fragmento", "fragmentos")} />
        <Dato icono={<Bot size={14} aria-hidden />} texto={plural(ficha.agentes.length, "agente la usa", "agentes la usan")} />
        <span aria-live="polite" className="inline-flex items-center gap-2">
          {aprendiendo ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-primary-fg">
              <Spinner size="sm" label="" />
              Aprendiendo… se actualiza solo
            </span>
          ) : null}
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <AnadirConocimiento cerebroId={ficha.id} onAnadido={refrescar} />
          <ListaFuentes cerebroId={ficha.id} fuentes={ficha.fuentesDetalle} onCambio={refrescar} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
          <PanelAgentes cerebroId={ficha.id} agentes={ficha.agentesDisponibles} onCambio={refrescar} />
          <Pruebalo cerebroId={ficha.id} hayFragmentos={ficha.fragmentos > 0} />
        </aside>
      </div>
    </div>
  );
}

function Dato({ icono, texto }: { icono: React.ReactNode; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-3 py-1">
      <span className="text-fg-muted">{icono}</span>
      <span className="tnum">{texto}</span>
    </span>
  );
}
