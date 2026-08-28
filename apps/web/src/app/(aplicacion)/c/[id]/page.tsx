/**
 * Un hilo con Strap.
 *
 * La ruta es `/c/{id}` y el id es la fila de `agent_drafts`: la conversación y
 * el borrador son la misma cosa. Por eso entrar aquí desde otro dispositivo,
 * tres días después, sigue funcionando.
 */
import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { MarcoApp } from "@/components/marco-app";
import { Hilo } from "@/components/meta/hilo";
import { datosDelMarco } from "@/lib/marco";
import { leerHilo } from "@/lib/meta/borradores";
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

  const abrir = typeof busqueda["abrir"] === "string" ? busqueda["abrir"] : undefined;
  const modo = busqueda["modo"] === "max" ? "max" : "lite";

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
      <Hilo
        hiloId={hilo.id}
        mensajesIniciales={hilo.mensajes as UIMessage[]}
        borradorInicial={hilo.borrador}
        modoInicial={modo}
        maxDisponible={marco.actual.esDesarrollo}
        {...(abrir ? { mensajeDeApertura: abrir } : {})}
      />
    </MarcoApp>
  );
}
