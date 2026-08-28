/**
 * Aprobación humana y backups: las dos reglas que hacen que este agente pueda
 * tocar el sitio de un cliente sin que eso sea temerario.
 *
 * APROBACIÓN. `@strappy/tools` marca herramientas como `sensitive` y el AI SDK
 * las corta con `needsApproval` antes de ejecutarlas. Eso cubre lo que es
 * sensible SIEMPRE (instalar plugins, borrar plugins, crear usuarios). Pero
 * "cambiar los precios" no es una herramienta distinta de "cambiar un texto":
 * es la MISMA herramienta con otra entrada. Esa parte no la puede decidir el
 * esquema, así que se decide aquí, dentro de `execute`, mirando la entrada y
 * el estado del sitio. La herramienta no ejecuta: registra una solicitud y
 * devuelve su identificador, y el trabajo queda suspendido.
 *
 * BACKUP. Antes de cada mutación se guarda el estado anterior y su
 * identificador viaja en el resultado. Es lo que convierte "revertir" en un
 * botón en vez de en una llamada a soporte.
 */
import { createHash } from "node:crypto";
import type { ToolContext } from "@strappy/tools";
import type { SitioContext } from "./ports.js";

// ---------------------------------------------------------------------------
// Qué es sensible
// ---------------------------------------------------------------------------

/** Páginas cuyo contenido mueve dinero o es la cara del negocio. */
const PATRON_DINERO = /(precio|precios|plan|planes|tarifa|tarifas|pricing|checkout|carrito|cart|pago|pagos|pagar|payment|suscrip|subscription|factur)/i;

/** Ajustes que redefinen qué ve un visitante al entrar. */
const AJUSTES_SENSIBLES = new Set(["show_on_front", "page_on_front", "page_for_posts", "siteurl", "home"]);

export type Sensibilidad = { readonly sensible: boolean; readonly motivo: string };

const NO: Sensibilidad = { sensible: false, motivo: "" };

/**
 * Decide si esta acción concreta necesita un clic humano.
 * `portadaId` es el `page_on_front` del sitio, leído antes de mutar: sin él no
 * se puede saber que "editar la página 12" es "editar la portada".
 */
export function evaluarSensibilidad(entrada: {
  toolSlug: string;
  titulo?: string;
  slug?: string;
  contenido?: string;
  contenidoId?: number;
  portadaId?: number;
  clavesAjustes?: readonly string[];
  tiposSeccion?: readonly string[];
}): Sensibilidad {
  const { toolSlug } = entrada;

  if (entrada.portadaId !== undefined && entrada.contenidoId === entrada.portadaId) {
    return { sensible: true, motivo: "es la portada del sitio" };
  }

  const claves = entrada.clavesAjustes ?? [];
  const tocadas = claves.filter((k) => AJUSTES_SENSIBLES.has(k));
  if (tocadas.length > 0) {
    return { sensible: true, motivo: `cambia ajustes de portada o dominio (${tocadas.join(", ")})` };
  }

  if (entrada.tiposSeccion?.includes("precios")) {
    return { sensible: true, motivo: "la página lleva una sección de precios" };
  }

  const texto = `${entrada.titulo ?? ""} ${entrada.slug ?? ""}`;
  if (PATRON_DINERO.test(texto)) {
    return { sensible: true, motivo: "es una página de precios, pagos o checkout" };
  }

  // El contenido se mira aparte y con menos peso: un post de blog que menciona
  // "precio" no es una página de precios. Solo cuenta si además cambia cifras.
  if (
    entrada.contenido &&
    PATRON_DINERO.test(entrada.contenido) &&
    /\d[\d.,]*\s*(€|\$|usd|eur|cop|mxn)/i.test(entrada.contenido)
  ) {
    return { sensible: true, motivo: "el contenido nuevo cambia importes" };
  }

  // Red de seguridad: si el registro marcó la herramienta como siempre
  // sensible y aun así llegó aquí, se pide aprobación igual.
  if (SIEMPRE_SENSIBLES.has(toolSlug)) {
    return { sensible: true, motivo: "es una operación de administración del sitio" };
  }

  return NO;
}

/** Herramientas que exigen aprobación sea cual sea su entrada. */
export const SIEMPRE_SENSIBLES = new Set([
  "wp_instalar_plugin",
  "wp_eliminar_plugin",
  "wp_cambiar_plugin",
  "wp_crear_usuario",
  "wp_cambiar_rol_usuario",
]);

// ---------------------------------------------------------------------------
// Huella
// ---------------------------------------------------------------------------

/** Serialización estable: las claves ordenadas, para que la huella no baile. */
function estable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(estable).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${estable(obj[k])}`)
    .join(",")}}`;
}

/**
 * Identifica UNA acción concreta. Una aprobación vale para exactamente lo que
 * se aprobó: si el modelo cambia un carácter del contenido, la huella cambia y
 * hace falta otro clic.
 */
export function huellaAccion(taskId: string, toolSlug: string, entrada: unknown): string {
  return createHash("sha256").update(`${taskId}|${toolSlug}|${estable(entrada)}`).digest("hex");
}

// ---------------------------------------------------------------------------
// La puerta
// ---------------------------------------------------------------------------

export type ResultadoPendiente = {
  readonly requiere_aprobacion: true;
  readonly solicitud_id: string;
  readonly motivo: string;
  readonly mensaje: string;
};

export type ResultadoRechazado = {
  readonly aprobacion_rechazada: true;
  readonly motivo: string;
  readonly mensaje: string;
};

export type Bloqueo = ResultadoPendiente | ResultadoRechazado;

export function esBloqueo(v: unknown): v is Bloqueo {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.requiere_aprobacion === true || o.aprobacion_rechazada === true;
}

/**
 * Llamar ANTES de mutar. Devuelve `null` si se puede seguir; si devuelve algo,
 * la herramienta tiene que devolverlo tal cual y NO tocar el sitio.
 */
export async function puertaDeAprobacion(
  ctx: ToolContext,
  sitio: SitioContext,
  toolSlug: string,
  entrada: unknown,
  sensibilidad: Sensibilidad,
): Promise<Bloqueo | null> {
  if (!sensibilidad.sensible) return null;
  // En simulación no se muta nada, así que tampoco se molesta a nadie con un
  // botón: el plan propuesto ya dirá qué acciones necesitarán aprobación.
  if (ctx.dryRun) return null;

  const huella = huellaAccion(sitio.taskId, toolSlug, entrada);
  const previa = await sitio.approvals.check({
    workspaceId: ctx.workspaceId,
    taskId: sitio.taskId,
    huella,
  });
  if (previa === "aprobada") return null;
  if (previa === "rechazada") {
    return {
      aprobacion_rechazada: true,
      motivo: sensibilidad.motivo,
      mensaje:
        "Una persona rechazó esta acción. No la reintentes: explica al cliente qué querías hacer y por qué, y sigue con el resto de la tarea.",
    };
  }

  const solicitud = await sitio.approvals.request({
    workspaceId: ctx.workspaceId,
    taskId: sitio.taskId,
    siteId: sitio.siteId,
    huella,
    toolSlug,
    motivo: sensibilidad.motivo,
    resumen: `${toolSlug}: ${sensibilidad.motivo}`,
    entrada,
  });

  return {
    requiere_aprobacion: true,
    solicitud_id: solicitud.id,
    motivo: sensibilidad.motivo,
    mensaje:
      "NO ejecuté esta acción porque " +
      `${sensibilidad.motivo}. Queda esperando el visto bueno de una persona. ` +
      "No la reintentes ni busques un rodeo: continúa con lo que sí puedas hacer y menciónalo en el RESUMEN.",
  };
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/** Guarda el estado anterior. En simulación no hay nada que guardar. */
export async function hacerBackup(
  ctx: ToolContext,
  sitio: SitioContext,
  alcance: string,
  snapshot: unknown,
): Promise<string | null> {
  if (ctx.dryRun) return null;
  return sitio.backups.create({
    workspaceId: ctx.workspaceId,
    siteId: sitio.siteId,
    taskId: sitio.taskId,
    alcance,
    snapshot,
  });
}
