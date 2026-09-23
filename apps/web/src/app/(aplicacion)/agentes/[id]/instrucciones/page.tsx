import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, rutas } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { ConstructorAgente } from "@/components/constructor-agente";
import { SelectorFoto } from "@/components/agentes/selector-foto";
import { InterruptorMax } from "@/components/agentes/interruptor-max";
import { datosDelMarco } from "@/lib/marco";
import { leerAgente } from "@/lib/agentes";
import { espacioConMax } from "@/lib/negocio/cartera";

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
  // El modo Max está en todos los planes de pago; lo enciende el cliente por
  // agente. En el gratuito se enseña apagado y se dice por qué.
  const planDePago = marco.actual.esDesarrollo || (await espacioConMax(marco.actual.workspaceId));
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
        nombreFijo={agente.tipo !== "conversational"}
        cabecera={
          // La cara se cambia AQUI, en la pantalla del agente, venga de donde
          // venga. Antes solo se ofrecia a los de WhatsApp, asi que a un agente
          // contratado no habia forma de cambiarsela desde su propia ficha: el
          // cliente lo busco justo aqui, que es donde tiene sentido buscarlo.
          <div className="flex flex-col gap-3">
            <SelectorFoto
              agentId={id}
              actual={agente.avatar}
              nombre={agente.nombre}
              variante={agente.tipo === "conversational" ? "whatsapp" : "catalogo"}
            />
            <InterruptorMax agentId={id} modo={agente.modo} planDePago={planDePago} />
          </div>
        }
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
