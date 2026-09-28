/**
 * Herramientas del Webmaster sobre el repositorio de un sitio hecho a medida.
 *
 * El agente trabaja como un desarrollador con cuidado: explora, lee antes de
 * tocar, cambia lo mínimo con ediciones exactas, revisa su diff, sube UN
 * commit, mira el build y la vista previa, y solo publica con el clic del
 * cliente. En qué rama trabaja lo decide el cliente con un botón, a propuesta
 * del agente.
 *
 * Tres familias:
 *  - Lectura (repo:read): nunca cambian nada.
 *  - Edición (repo:write, efecto interno): cambian la copia del encargo, no el
 *    repositorio. Por eso funcionan también en simulación: el plan de un primer
 *    contacto puede enseñar el diff exacto sin haber subido nada.
 *  - Efecto externo (repo:write): commit, PR, comentario y publicar. Estas sí
 *    tocan GitHub, se simulan en seco y pasan por la aprobación cuando toca.
 */
import type { ToolDef } from "@strappy/tools";
import { repoInfo, repoArbol, repoLeer, repoBuscar, repoRamas, repoHistorial, repoCambiosRecientes, repoVerCambios } from "./explorar.js";
import { repoElegirRama } from "./rama.js";
import { repoEditar, repoEscribir, repoBorrar, repoMover, repoDescartar, repoAgregarImagen, repoDeshacer } from "./editar.js";
import { repoGuardarCambios, repoAbrirPr, repoEstadoDespliegue, repoVerVistaPrevia, repoLeerRevision, repoComentarPr, repoPublicar } from "./publicar.js";

export * from "./explorar.js";
export * from "./rama.js";
export * from "./editar.js";
export * from "./publicar.js";

export const HERRAMIENTAS_REPO: readonly ToolDef<never, unknown>[] = [
  repoInfo,
  repoArbol,
  repoLeer,
  repoBuscar,
  repoRamas,
  repoHistorial,
  repoCambiosRecientes,
  repoVerCambios,
  repoElegirRama,
  repoEditar,
  repoEscribir,
  repoBorrar,
  repoMover,
  repoDescartar,
  repoAgregarImagen,
  repoDeshacer,
  repoGuardarCambios,
  repoAbrirPr,
  repoEstadoDespliegue,
  repoVerVistaPrevia,
  repoLeerRevision,
  repoComentarPr,
  repoPublicar,
] as unknown as readonly ToolDef<never, unknown>[];
