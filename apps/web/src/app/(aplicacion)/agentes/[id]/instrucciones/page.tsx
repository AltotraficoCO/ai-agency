import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, rutas } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { ConstructorAgente } from "@/components/constructor-agente";
import { SelectorFoto } from "@/components/agentes/selector-foto";
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
  const seccion = seccionDe(agente.tipo);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto={<Link href={seccion.href}>{seccion.etiqueta}</Link>}
        rutaActiva={seccion.ruta}
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
      <ConstructorAgente
        agentId={id}
        inicial={agente.spec}
        publicado={agente.publicado}
        {...(agente.tipo === "conversational"
          ? { cabecera: <SelectorFoto agentId={id} actual={agente.avatar} nombre={agente.nombre} /> }
          : {})}
      />
    </MarcoApp>
  );
}

/** Un agente de WhatsApp vuelve a Comunicaciones; uno por encargo, a tu equipo. */
function seccionDe(tipo: string) {
  return tipo === "conversational"
    ? { href: rutas.agentesWhatsapp, etiqueta: "Agentes de WhatsApp", ruta: rutas.agentesWhatsapp }
    : { href: rutas.agentes, etiqueta: "Tu equipo", ruta: rutas.agentes };
}
