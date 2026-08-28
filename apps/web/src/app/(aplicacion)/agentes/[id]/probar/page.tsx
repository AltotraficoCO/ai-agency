import Link from "next/link";
import { notFound } from "next/navigation";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { SimuladorChat } from "@/components/simulador-chat";
import { datosDelMarco } from "@/lib/marco";
import { leerAgente } from "@/lib/agentes";
import { asegurarSesion, leerHistorial } from "@/lib/motor/simulador";
import { hayModeloReal } from "@/lib/motor/modelo";

export const metadata = { title: "Probar el agente" };
export const dynamic = "force-dynamic";

export default async function PaginaProbar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marco = await datosDelMarco();
  const agente = await leerAgente(marco.actual.workspaceId, id);
  if (!agente) notFound();

  const conversationId = await asegurarSesion({
    workspaceId: marco.actual.workspaceId,
    agentId: id,
  });
  const historial = await leerHistorial({
    workspaceId: marco.actual.workspaceId,
    conversationId,
  });

  const saldo = Math.max(0, marco.creditos.total - marco.creditos.consumidos);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto={<Link href="/agentes">Agentes</Link>}
      titulo={`Probar · ${agente.nombre}`}
      acciones={
        <EnlaceBoton size="sm" variant="ghost" href={`/agentes/${id}/instrucciones`}>
          Instrucciones
        </EnlaceBoton>
      }
    >
      {agente.publicado ? (
        <SimuladorChat
          agentId={id}
          conversationId={conversationId}
          historial={historial}
          nombreAgente={agente.spec.identidad.nombre || agente.nombre}
          saldoInicial={saldo}
          modeloDeEnsayo={!hayModeloReal()}
        />
      ) : (
        <div className="mx-auto max-w-md py-20 text-center">
          <h2 className="text-xl font-semibold text-fg">Este agente aún no está publicado</h2>
          <p className="mt-2 text-base text-fg-secondary">
            El motor solo ejecuta la versión publicada. Termina sus instrucciones y publícalo para
            poder probarlo.
          </p>
          <EnlaceBoton className="mt-4" href={`/agentes/${id}/instrucciones`}>
            Ir a las instrucciones
          </EnlaceBoton>
        </div>
      )}
    </MarcoApp>
  );
}
