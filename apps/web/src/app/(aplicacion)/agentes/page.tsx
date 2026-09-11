/**
 * Los agentes del espacio.
 *
 * Dos grupos que no se mezclan: los que ya trabajan para ti y los que puedes
 * contratar. Mezclados en una sola rejilla, un agente gris sin contratar se
 * confundía con uno propio en borrador. La acción principal —contratar— va en
 * el encabezado, siempre a la vista.
 */
import { Plus, Sparkles } from "lucide-react";
import { EncabezadoPagina } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { TarjetaAgente, TarjetaCatalogo } from "@/components/tarjeta-agente";
import { datosDelMarco } from "@/lib/marco";
import { listarAgentes, type ResumenAgente } from "@/lib/agentes";
import { catalogoDelEspacio } from "@/lib/negocio/catalogo";

export const metadata = { title: "Agentes" };
export const dynamic = "force-dynamic";

/** A dónde lleva la tarjeta: al trabajo del agente, o a terminarlo si es un borrador propio. */
function destinoDe(agente: ResumenAgente): string {
  if (agente.activo || agente.catalogo) return `/agentes/${agente.id}/probar`;
  return `/agentes/${agente.id}/instrucciones`;
}

export default async function PaginaAgentes() {
  const marco = await datosDelMarco();
  const [agentes, catalogo] = await Promise.all([
    listarAgentes(marco.actual.workspaceId),
    catalogoDelEspacio(marco.actual.workspaceId),
  ]);
  const activos = agentes.filter((a) => a.activo).length;
  const disponibles = catalogo.filter((f) => !f.contratado);

  const resumen =
    agentes.length === 0
      ? "Todavía no tienes ninguno. Crea uno con Strap o contrata uno listo para trabajar."
      : `${activos} ${activos === 1 ? "activo" : "activos"} de ${agentes.length}. Abre uno para probarlo o ajustar lo que hace.`;

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Agentes"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
        <EncabezadoPagina
          titulo="Tus agentes"
          descripcion={resumen}
          acciones={
            <>
              <EnlaceBoton variant="secondary" href="/">
                <Sparkles size={16} aria-hidden />
                Crear con Strap
              </EnlaceBoton>
              <EnlaceBoton href="/contratar">
                <Plus size={16} aria-hidden />
                Contratar agente
              </EnlaceBoton>
            </>
          }
        />

        <section aria-labelledby="trabajando" className="strappy-slide-up flex flex-col gap-4">
          <Titulo id="trabajando" texto="Trabajando para ti" cuenta={agentes.length} />
          {agentes.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {agentes.map((agente) => (
                <TarjetaAgente
                  key={agente.id}
                  agente={{
                    id: agente.id,
                    nombre: agente.nombre,
                    catalogo: agente.catalogo,
                    estado: agente.estado,
                    modo: agente.modo,
                    activo: agente.activo,
                  }}
                  destino={destinoDe(agente)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="text-lg font-semibold text-fg">Aún no hay nadie trabajando</p>
              <p className="max-w-[52ch] text-base text-fg-secondary">
                Cuéntale a Strap cómo es tu negocio y en unos minutos tendrás un agente atendiendo tu
                WhatsApp.
              </p>
              <EnlaceBoton href="/" size="lg">
                <Sparkles size={16} aria-hidden />
                Crear mi primer agente
              </EnlaceBoton>
            </div>
          )}
        </section>

        {disponibles.length > 0 ? (
          <section aria-labelledby="disponibles" className="strappy-slide-up flex flex-col gap-4">
            <Titulo
              id="disponibles"
              texto="Disponibles para contratar"
              cuenta={disponibles.length}
              ayuda="Ya vienen construidos: los contratas, conectas lo que les falte y empiezan."
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {disponibles.map((ficha) => (
                <TarjetaCatalogo
                  key={ficha.slug}
                  ficha={{
                    slug: ficha.slug,
                    nombre: ficha.nombre,
                    tagline: ficha.tagline,
                    costeUsd: ficha.costeUsd,
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </MarcoApp>
  );
}

function Titulo({ id, texto, cuenta, ayuda }: { id: string; texto: string; cuenta: number; ayuda?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold text-fg">
        {texto}
        <span className="tnum rounded-full bg-hover px-2 py-0.5 text-2xs font-medium text-fg-muted">{cuenta}</span>
      </h2>
      {ayuda ? <p className="text-sm text-fg-muted">{ayuda}</p> : null}
    </div>
  );
}
