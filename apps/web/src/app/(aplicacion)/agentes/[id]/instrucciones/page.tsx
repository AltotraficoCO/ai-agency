import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { ConstructorAgente } from "@/components/constructor-agente";
import { datosDelMarco } from "@/lib/marco";
import { leerAgente } from "@/lib/agentes";

export const metadata = { title: "Instrucciones del agente" };
export const dynamic = "force-dynamic";

export default async function PaginaInstrucciones({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const marco = await datosDelMarco();
  const agente = await leerAgente(marco.actual.workspaceId, id);
  if (!agente) notFound();

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto={<Link href="/agentes">Agentes</Link>}
      titulo={agente.nombre}
      acciones={
        <>
          {agente.hayCambiosSinPublicar && <Badge tone="aviso">Cambios sin publicar</Badge>}
          <EnlaceBoton size="sm" variant="secondary" href={`/agentes/${id}/probar`}>
            Probar
          </EnlaceBoton>
        </>
      }
    >
      <ConstructorAgente agentId={id} inicial={agente.spec} publicado={agente.publicado} />
    </MarcoApp>
  );
}
