/**
 * Estado vacío honesto.
 *
 * Cada sección que todavía no existe dice EXACTAMENTE qué va a hacer y qué
 * falta para que funcione. Una pantalla vacía que solo dice «no hay nada» hace
 * pensar que el producto está roto; una que dice qué falta, no.
 */
import { EmptyState } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";

export async function PaginaVacia({
  titulo,
  encabezado,
  descripcion,
}: {
  titulo: string;
  encabezado: string;
  descripcion: string;
}) {
  const marco = await datosDelMarco();
  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo={titulo}
    >
      <div className="grid min-h-full place-items-center">
        <EmptyState variant="primera-vez" title={encabezado} description={descripcion} />
      </div>
    </MarcoApp>
  );
}
