/**
 * Conocimiento: lo que tus agentes saben de tu negocio.
 *
 * Esta pantalla NO crea agentes. Crea bases de conocimiento y las alimenta con
 * un sitio web, archivos o datos pegados; los agentes de WhatsApp las usan
 * cuando se conectan a ellas.
 */
import { EncabezadoPagina } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { NuevaBase } from "@/components/conocimiento/nueva-base";
import { TarjetaBase } from "@/components/conocimiento/tarjeta-base";
import { VacioConocimiento } from "@/components/conocimiento/vacio-conocimiento";
import { plural } from "@/components/conocimiento/formato";
import { listarCerebros } from "@/lib/conocimiento/conocimiento";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Conocimiento" };

// Lee el espacio en cada visita: las fuentes cambian mientras aprenden.
export const dynamic = "force-dynamic";

export default async function PaginaConocimiento() {
  const marco = await datosDelMarco();
  const bases = await listarCerebros(marco.actual.workspaceId);
  const fuentes = bases.reduce((total, b) => total + b.fuentes, 0);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="WhatsApp"
      titulo="Conocimiento"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <EncabezadoPagina
          titulo="Conocimiento"
          descripcion={
            bases.length > 0
              ? `Lo que tus agentes saben de tu negocio: ${plural(bases.length, "base", "bases")} con ${plural(fuentes, "fuente", "fuentes")}.`
              : "Lo que tus agentes saben de tu negocio. Dales tu web, tus documentos o tus datos."
          }
          {...(bases.length > 0 ? { acciones: <NuevaBase /> } : {})}
        />

        {bases.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bases.map((base, indice) => (
              <TarjetaBase key={base.id} base={base} indice={indice} />
            ))}
          </div>
        ) : (
          <VacioConocimiento />
        )}
      </div>
    </MarcoApp>
  );
}
