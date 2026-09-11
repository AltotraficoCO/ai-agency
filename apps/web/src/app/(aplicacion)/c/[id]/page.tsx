/**
 * Un hilo con Strap.
 *
 * La ruta es `/c/{id}` y el id es la fila de `agent_drafts`: la conversación y
 * el borrador son la misma cosa. Por eso entrar aquí desde otro dispositivo,
 * tres días después, sigue funcionando.
 *
 * A la izquierda, el historial de conversaciones con Strap para saltar de una
 * a otra sin volver a Inicio; a la derecha, el hilo.
 */
import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { MarcoApp } from "@/components/marco-app";
import { Hilo } from "@/components/meta/hilo";
import { PanelHistorial, type ItemHistorial } from "@/components/conversacion/panel-historial";
import { datosDelMarco } from "@/lib/marco";
import { leerHilo, listarHilos } from "@/lib/meta/borradores";
import { ETIQUETA_FASE } from "@strappy/core";

export const dynamic = "force-dynamic";

export default async function PaginaHilo({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const busqueda = await searchParams;
  const marco = await datosDelMarco();
  const hilo = await leerHilo(marco.actual.workspaceId, id);
  if (!hilo) notFound();
  const hilos = await listarHilos(marco.actual.workspaceId, 30);

  const abrir = typeof busqueda["abrir"] === "string" ? busqueda["abrir"] : undefined;
  const modo = busqueda["modo"] === "max" ? "max" : "lite";

  const historial: ItemHistorial[] = hilos.map((h) => ({
    id: h.id,
    titulo: h.titulo,
    fecha: h.actualizado,
    href: `/c/${h.id}`,
    estado: h.publicado
      ? { texto: "Publicado", tono: "exito" as const }
      : { texto: h.etiquetaFase, tono: "neutral" as const },
  }));

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Strap"
      titulo={hilo.titulo}
      acciones={
        <span className="text-sm text-fg-muted">{ETIQUETA_FASE[hilo.fase]}</span>
      }
    >
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <PanelHistorial
          titulo="Conversaciones"
          items={historial}
          activoId={hilo.id}
          claveAlmacen="strappy-historial-strap"
          vacio="Tus conversaciones con Strap aparecerán aquí."
          nuevo={{ etiqueta: "Nueva conversación", href: "/" }}
        />
        <div className="min-h-0 min-w-0 flex-1">
          <Hilo
            hiloId={hilo.id}
            mensajesIniciales={hilo.mensajes as UIMessage[]}
            borradorInicial={hilo.borrador}
            modoInicial={modo}
            maxDisponible={marco.actual.esDesarrollo}
            {...(abrir ? { mensajeDeApertura: abrir } : {})}
          />
        </div>
      </div>
    </MarcoApp>
  );
}
