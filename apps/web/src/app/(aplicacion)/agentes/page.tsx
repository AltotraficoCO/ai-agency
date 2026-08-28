/**
 * Los agentes del espacio.
 *
 * Es la única lista de esta fase que enseña datos reales, y por eso importa que
 * diga la verdad: un agente en borrador no atiende a nadie, y la tarjeta lo dice
 * en lugar de dejar creer que sí.
 */
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";
import { listarAgentes, type ResumenAgente } from "@/lib/agentes";

export const metadata = { title: "Agentes" };
export const dynamic = "force-dynamic";

const ESTADOS: Record<ResumenAgente["estado"], { texto: string; tono: "exito" | "neutral" | "aviso" }> = {
  published: { texto: "Publicado", tono: "exito" },
  draft: { texto: "Borrador", tono: "neutral" },
  paused: { texto: "En pausa", tono: "aviso" },
  archived: { texto: "Archivado", tono: "neutral" },
};

export default async function PaginaAgentes() {
  const marco = await datosDelMarco();
  const agentes = await listarAgentes(marco.actual.workspaceId);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Agentes"
      acciones={
        <EnlaceBoton size="sm" href="/contratar">Contratar agente</EnlaceBoton>
      }
    >
      {agentes.length === 0 ? (
        <div className="grid min-h-full place-items-center">
          <EmptyState
            variant="primera-vez"
            title="Todavía no tienes agentes"
            description="Un agente es quien atiende por ti. Contrata uno del catálogo o pídele al asistente que construya el tuyo."
            action={
              <EnlaceBoton href="/contratar">Ver el catálogo</EnlaceBoton>
            }
          />
        </div>
      ) : (
        <div className="mx-auto grid max-w-5xl gap-3 p-6 sm:grid-cols-2">
          {agentes.map((agente) => {
            const estado = ESTADOS[agente.estado];
            return (
              <Card key={agente.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{agente.nombre}</CardTitle>
                    <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">
                      {agente.descripcion ?? "Sin descripción todavía."}
                    </p>
                  </div>
                  <Badge tone={estado.tono}>{estado.texto}</Badge>
                </CardHeader>
                <CardBody className="flex flex-wrap items-center gap-2">
                  <span className="text-2xs text-fg-muted">
                    {agente.conversaciones === 0
                      ? "Sin conversaciones todavía"
                      : `${agente.conversaciones} conversaciones`}
                    {" · "}
                    {agente.modo === "max" ? "Modo máximo" : "Modo económico"}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <EnlaceBoton size="sm" variant="ghost" href={`/agentes/${agente.id}/instrucciones`}>
                      Instrucciones
                    </EnlaceBoton>
                    <EnlaceBoton size="sm" variant="secondary" href={`/agentes/${agente.id}/probar`}>
                      Probar
                    </EnlaceBoton>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </MarcoApp>
  );
}
