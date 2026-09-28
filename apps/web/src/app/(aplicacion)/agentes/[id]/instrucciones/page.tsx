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
import { SeccionRepositorio } from "@/components/negocio/seccion-repositorio";
import { sitioDelEspacio } from "@/lib/sitio/sitio";

export const metadata = { title: "Instrucciones del agente" };
export const dynamic = "force-dynamic";

export default async function PaginaInstrucciones({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ github?: string; detalle?: string }>;
}) {
  const [{ id }, vuelta] = await Promise.all([params, searchParams]);
  const marco = await datosDelMarco();
  const agente = await leerAgente(marco.actual.workspaceId, id);
  if (!agente) notFound();
  // El modo Max está en todos los planes de pago; lo enciende el cliente por
  // agente. En el gratuito se enseña apagado y se dice por qué.
  const planDePago = marco.actual.esDesarrollo || (await espacioConMax(marco.actual.workspaceId));
  const seccion = seccionDe(agente.tipo);
  // El Webmaster necesita saber DÓNDE trabaja, y el cliente lo busca aquí, en
  // la ficha de su agente, no solo en Ajustes.
  const esWebmaster = agente.catalogo === "webmaster";
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";
  const sitio = esWebmaster ? await sitioDelEspacio(marco.actual.workspaceId) : null;

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
            {esWebmaster && (
              <>
                <DondeTrabaja sitio={sitio} />
                <SeccionRepositorio
                  workspaceId={marco.actual.workspaceId}
                  puedeEditar={puedeEditar}
                  volver={`/agentes/${id}/instrucciones#repositorio`}
                  agenteId={id}
                  github={vuelta.github}
                  detalle={vuelta.detalle}
                />
              </>
            )}
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

/** En qué sitio trabaja el Webmaster ahora mismo, y dónde se conecta un WordPress. */
function DondeTrabaja({ sitio }: { sitio: Awaited<ReturnType<typeof sitioDelEspacio>> }) {
  return (
    <section className="strappy-slide-up flex flex-col gap-1 rounded-xl border border-border bg-raised px-5 py-4 shadow-e1">
      <h2 className="text-lg font-semibold tracking-tight text-fg">Dónde trabaja</h2>
      <p className="text-sm text-fg-secondary">
        {sitio
          ? sitio.tipo === "repo"
            ? `En el código de ${sitio.repositorio ?? "tu repositorio"}, que se ve en ${sitio.url}.`
            : sitio.tipo === "custom"
              ? `En ${sitio.url}, por el conector de tu sitio.`
              : `En tu WordPress, ${sitio.url}.`
          : "Todavía en ningún sitio: conecta tu WordPress o el repositorio de tu web."}{" "}
        <Link href="/ajustes/sitio" className="text-primary-fg underline-offset-4 hover:underline">
          {sitio?.tipo === "wp" ? "Cambiar su WordPress" : "¿Es un WordPress? Conéctalo aquí"}
        </Link>
      </p>
    </section>
  );
}
