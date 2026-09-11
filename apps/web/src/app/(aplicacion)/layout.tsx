/**
 * Grupo de rutas de la aplicación.
 *
 * El menú lateral vive AQUÍ y no en cada página. Cuando lo pintaba cada una,
 * navegar de Inicio a Ajustes desmontaba el menú entero y lo volvía a montar:
 * parecía que la página se recargaba y el menú desaparecía un instante. Un
 * layout de Next se conserva entre navegaciones, así que el menú se queda
 * quieto y solo cambia el contenido de la derecha.
 *
 * La barra superior sí la pinta cada página (`MarcoApp`), porque su título y
 * sus acciones son distintos en cada una.
 */
import { ArmazonApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";

export default async function LayoutAplicacion({ children }: { children: React.ReactNode }) {
  const marco = await datosDelMarco();
  return (
    <ArmazonApp usuario={marco.usuario} creditos={marco.creditos} pendientes={marco.pendientes}>
      {children}
    </ArmazonApp>
  );
}
