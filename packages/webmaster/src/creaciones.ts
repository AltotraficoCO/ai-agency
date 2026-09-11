/**
 * Cuántos contenidos NUEVOS crea una tarea.
 *
 * «Crea un blog de Inteligencia Artificial y Uso Responsable» terminó en tres
 * entradas: el modelo leyó «un blog» como «una serie». Una petición en singular
 * es UNA entrada, y eso no puede depender de que el modelo lea bien la regla
 * del prompt: la herramienta lleva la cuenta y frena la segunda creación con un
 * error que dice qué hacer.
 *
 * La cuenta vive en el `SitioContext`, que es el mismo objeto durante toda una
 * ejecución (como la caché del diseño). La plaza se reserva de forma síncrona,
 * antes de cualquier `await`, para que dos llamadas en paralelo del mismo paso
 * no pasen las dos el control.
 */
import type { SitioContext } from "./ports.js";

type TipoContenido = "page" | "post";

type Creacion = { id: number | null; tipo: TipoContenido; titulo: string };

const porEjecucion = new WeakMap<SitioContext, Creacion[]>();

const NOMBRE: Readonly<Record<TipoContenido, string>> = { page: "la página", post: "la entrada" };

export type Reserva = {
  /** El contenido quedó creado con este id. */
  confirmar(id: number): void;
  /** No se creó nada (bloqueo, error): la plaza vuelve a quedar libre. */
  liberar(): void;
};

/** Contenidos nuevos creados (o en curso) en esta ejecución. */
export function creacionesDe(sitio: SitioContext): readonly Creacion[] {
  return porEjecucion.get(sitio) ?? [];
}

/**
 * Reserva la creación de un contenido nuevo o lanza el error que explica por
 * qué no. `cantidadPedida` es cuántos pidió el cliente; por defecto, uno.
 */
export function reservarCreacion(
  sitio: SitioContext,
  pedido: { tipo: TipoContenido; titulo: string; cantidadPedida?: number | undefined },
): Reserva {
  let lista = porEjecucion.get(sitio);
  if (!lista) {
    lista = [];
    porEjecucion.set(sitio, lista);
  }
  const limite = Math.max(1, pedido.cantidadPedida ?? 1);
  if (lista.length >= limite) {
    const primero = lista[0]!;
    const cual = primero.id !== null ? `${NOMBRE[primero.tipo]} ${primero.id} («${primero.titulo}»)` : `${NOMBRE[primero.tipo]} «${primero.titulo}»`;
    throw new Error(
      `Ya creaste ${cual} en esta tarea${lista.length > 1 ? ` y ${lista.length - 1} más` : ""}. ` +
        "«Un blog», «un post» o «un artículo» es UNA sola entrada. " +
        "Si el cliente pidió varias, indica cuántas en `cantidad_pedida`; si no, edita esa con contenido_id en vez de crear otra.",
    );
  }
  const plaza: Creacion = { id: null, tipo: pedido.tipo, titulo: pedido.titulo };
  lista.push(plaza);
  return {
    confirmar(id) {
      plaza.id = id;
    },
    liberar() {
      const i = lista.indexOf(plaza);
      if (i >= 0) lista.splice(i, 1);
    },
  };
}
