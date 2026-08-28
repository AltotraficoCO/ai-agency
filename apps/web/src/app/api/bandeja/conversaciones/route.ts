/**
 * La lista de la bandeja.
 *
 * Existe como ruta —y no solo como carga del servidor— porque la lista se
 * refresca sola: cuando llega un mensaje por Realtime, o cada pocos segundos
 * cuando la conexión en vivo no está disponible, el navegador vuelve a pedir
 * aquí en vez de recargar la página entera.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { contarPestanas, listarConversaciones } from "@/lib/bandeja/consultas";
import { FILTROS_INICIALES, type Filtros, type Pestana } from "@/lib/bandeja/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PESTANAS: readonly Pestana[] = ["todas", "mias", "sin-asignar", "sin-leer"];
const ESTADOS = ["abiertas", "pospuestas", "cerradas", "todas"] as const;

/**
 * Sin `export`: en una ruta de Next, cualquier exportación que no sea un método
 * HTTP o una opción de segmento es un error de tipos. Es la clase de detalle que
 * solo aparece al compilar, no al ejecutar en desarrollo.
 */
function filtrosDesdeParametros(parametros: URLSearchParams): Filtros {
  const leer = (clave: string): string | null => {
    const valor = parametros.get(clave);
    return valor && valor.trim() ? valor.trim() : null;
  };
  const pestana = parametros.get("pestana");
  const estado = parametros.get("estado");

  return {
    ...FILTROS_INICIALES,
    pestana: PESTANAS.includes(pestana as Pestana) ? (pestana as Pestana) : "todas",
    busqueda: leer("busqueda") ?? "",
    estado: ESTADOS.includes(estado as (typeof ESTADOS)[number])
      ? (estado as Filtros["estado"])
      : "abiertas",
    canalId: leer("canal"),
    asignadoId: leer("asignado"),
    agenteId: leer("agente"),
    etiquetaId: leer("etiqueta"),
    desde: leer("desde"),
    hasta: leer("hasta"),
    soloUrgentes: parametros.get("urgentes") === "1",
  };
}

export async function GET(peticion: Request) {
  const usuario = await exigirUsuarioActual();
  const filtros = filtrosDesdeParametros(new URL(peticion.url).searchParams);

  const [conversaciones, contadores] = await Promise.all([
    listarConversaciones({
      workspaceId: usuario.workspaceId,
      usuarioId: usuario.id,
      filtros,
    }),
    contarPestanas({ workspaceId: usuario.workspaceId, usuarioId: usuario.id }),
  ]);

  return Response.json({ conversaciones, contadores });
}
