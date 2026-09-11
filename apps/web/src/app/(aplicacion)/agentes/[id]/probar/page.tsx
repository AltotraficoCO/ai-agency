import Link from "next/link";
import { notFound } from "next/navigation";
import { EncargosWebmaster } from "@/components/encargos-webmaster";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { SimuladorChat } from "@/components/simulador-chat";
import { datosDelMarco } from "@/lib/marco";
import { leerAgente } from "@/lib/agentes";
import {
  accionDecidirAprobacion,
  accionEliminarEncargo,
  accionEncargar,
  accionResponderPregunta,
  accionVaciarEncargos,
} from "@/lib/encargos/acciones";
import { encargosDelAgente, esWebmaster } from "@/lib/encargos/encargos";
import { asegurarSesion, leerHistorial } from "@/lib/motor/simulador";
import { hayModeloReal } from "@/lib/motor/modelo";
import { sitioDelEspacio } from "@/lib/sitio/sitio";

export const metadata = { title: "Probar el agente" };
export const dynamic = "force-dynamic";

export default async function PaginaProbar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marco = await datosDelMarco();
  const agente = await leerAgente(marco.actual.workspaceId, id);
  if (!agente) notFound();
  const nombreAgente = agente.spec.identidad.nombre || agente.nombre;

  // El Webmaster no se prueba conversando: se le encargan cambios reales en el
  // sitio y los ejecuta el worker. Por el simulador solo podía escalar a una
  // persona, que es justo lo que no tiene que hacer. Ver lib/encargos.
  if (await esWebmaster(marco.actual.workspaceId, id)) {
    const [sitio, encargos] = await Promise.all([
      sitioDelEspacio(marco.actual.workspaceId),
      encargosDelAgente(marco.actual.workspaceId, id),
    ]);
    return (
      <MarcoApp
        usuario={marco.usuario}
        creditos={marco.creditos}
        pendientes={marco.pendientes}
        contexto={<Link href="/agentes">Agentes</Link>}
        titulo={`Encargos · ${agente.nombre}`}
      >
        <EncargosWebmaster
          nombreAgente={nombreAgente}
          sitio={sitio && sitio.estado === "active" ? { nombre: sitio.nombre, url: sitio.url } : null}
          encargos={encargos}
          encargar={accionEncargar.bind(null, id)}
          decidir={accionDecidirAprobacion.bind(null, id)}
          responder={accionResponderPregunta.bind(null, id)}
          eliminar={accionEliminarEncargo.bind(null, id)}
          vaciar={accionVaciarEncargos.bind(null, id)}
        />
      </MarcoApp>
    );
  }

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
          nombreAgente={nombreAgente}
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
