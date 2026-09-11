/**
 * Los agentes del espacio.
 *
 * Cada agente con su cara y un punto que dice la verdad: verde si atiende o
 * trabaja ahora mismo, gris si todavía no hace nada. Los activos van primero;
 * detrás, en gris, los del catálogo que el espacio aún no tiene, para que
 * contratar uno esté a un clic y no escondido en otra pantalla.
 */
import { MarcoApp } from "@/components/marco-app";
import { TarjetaAgente, TarjetaCatalogo, TarjetaContratar } from "@/components/tarjeta-agente";
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
      ? "Todavía no tienes ninguno. Contrata el primero: los que ves en gris están listos para trabajar."
      : `${activos} ${activos === 1 ? "activo" : "activos"} de ${agentes.length}` +
        (disponibles.length > 0
          ? ` · ${disponibles.length} ${disponibles.length === 1 ? "disponible" : "disponibles"} para contratar`
          : "");

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Agentes"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold text-fg">Tus agentes</h1>
          <p className="mt-1 text-sm text-fg-secondary">{resumen}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <TarjetaContratar />
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
      </div>
    </MarcoApp>
  );
}
