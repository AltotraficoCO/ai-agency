/**
 * La bandeja: la pantalla donde se vive el producto.
 *
 * El servidor entrega la primera lista ya montada —nada de un esqueleto que se
 * rellena a los 400 ms— y a partir de ahí la pantalla se mantiene sola: en vivo
 * si esta instalación tiene tiempo real, y sondeando si no, diciéndolo siempre.
 */
import { Bandeja } from "@/components/bandeja/bandeja";
import { contarPestanas, leerCatalogos, listarConversaciones } from "@/lib/bandeja/consultas";
import { FILTROS_INICIALES } from "@/lib/bandeja/tipos";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Bandeja" };

// Todo lo que se pinta aquí depende de quién eres y de lo que acaba de pasar.
export const dynamic = "force-dynamic";

export default async function Pagina() {
  const marco = await datosDelMarco();
  const { actual } = marco;

  const [conversaciones, contadores, catalogos] = await Promise.all([
    listarConversaciones({
      workspaceId: actual.workspaceId,
      usuarioId: actual.id,
      filtros: FILTROS_INICIALES,
    }),
    contarPestanas({ workspaceId: actual.workspaceId, usuarioId: actual.id }),
    leerCatalogos({
      workspaceId: actual.workspaceId,
      usuario: {
        id: actual.id,
        nombre: actual.nombre,
        ...(actual.avatarUrl ? { avatar: actual.avatarUrl } : {}),
      },
    }),
  ]);

  return (
    <Bandeja
      inicial={{
        conversaciones,
        contadores,
        catalogos,
        workspaceId: actual.workspaceId,
        esDesarrollo: actual.esDesarrollo,
        usuario: marco.usuario,
        creditos: marco.creditos,
      }}
    />
  );
}
