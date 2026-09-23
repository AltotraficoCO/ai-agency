/**
 * El Webmaster, montado sobre el bucle común de los agentes por encargo.
 *
 * El bucle en sí —tope de acciones, freno de repeticiones, registro de trabajo
 * en vivo, aprobaciones del AI SDK, cobro por tokens y por herramienta, timeout
 * duro— vive ahora en `@strappy/agentes` y lo comparten todos los agentes que
 * trabajan por encargo. Aquí queda lo que de verdad es del Webmaster: el sitio
 * del cliente, sus credenciales, las capturas del navegador y cómo se describe
 * al cliente lo que hay que aprobar.
 *
 * Por qué se separó: el agente de Marketing necesitaba exactamente el mismo
 * bucle, y copiarlo habría significado dos sitios donde arreglar el próximo
 * fallo. Lo que NO cambió es el comportamiento: mismos textos, mismos límites,
 * misma evidencia. Es lo único que hoy factura.
 *
 * Esto es lo que sustituyó a OpenCode. El proyecto anterior arrancaba un
 * binario de unos 100 MB por tarea y no devolvía consumo de tokens: con un
 * sistema de créditos, un agente cuyo gasto no se puede medir no se puede
 * vender.
 */
import {
  contextoComun,
  filtrarHerramientas,
  lanzarOficio,
  oficioComun,
  type CapturaEvidencia,
  type EntradaComunDeAgente,
  type OficioDelAgente,
} from "@strappy/agentes";
import { redactSecrets, type ToolDef } from "@strappy/tools";
import {
  AVISO_VELOCIDAD_PARA_WEBMASTER,
  BLOQUE_VELOCIDAD_PARA_WEBMASTER,
  HERRAMIENTAS_VELOCIDAD,
  detalleDePasoVelocidad,
  etiquetaDePasoVelocidad,
  hablaDeVelocidad,
  huellaAccion as huellaVelocidad,
  SCOPES_VELOCISTA,
  type VelocidadContext,
} from "@strappy/velocista";
import type { SkillAgentDef } from "./agent.js";
import type { WebmasterContext } from "./context.js";
import type { ColectorCapturas, SitioContext } from "./ports.js";
import { huellaAccion } from "./aprobacion.js";
import { detalleDePaso, etiquetaDePaso, type PasoTrabajo } from "./pasos.js";
import { HERRAMIENTAS_WEBMASTER } from "./tools/index.js";

// Los tipos del resultado y de la evidencia son los del armazón común: la web,
// el worker y la facturación ya hablan ese vocabulario.
export type {
  AccionRegistrada,
  CapturaEvidencia,
  Evidencia,
  ResultadoTarea,
  SolicitudAprobacion,
  TareaEncargo,
  UsoAgregado,
} from "@strappy/agentes";
export { extraerResumen, quitarRazonamiento } from "@strappy/agentes";

import type { ResultadoTarea } from "@strappy/agentes";

// ---------------------------------------------------------------------------
// Filtro de herramientas: deny by default
// ---------------------------------------------------------------------------

export function herramientasDe(agent: SkillAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_WEBMASTER, agent.allowedToolPatterns);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Lo común a todos los agentes por encargo, más el sitio del cliente. */
export type EjecucionInput = EntradaComunDeAgente & {
  readonly agent: SkillAgentDef;
  readonly sitio: SitioContext;
  /**
   * La velocidad del sitio, que desde el 22-sep-2026 es parte del Webmaster:
   * medidor, historial de mediciones y lo que hace falta para activar la caché.
   * Sin esto el Webmaster trabaja igual, solo que no puede medir.
   */
  readonly velocidad?: VelocidadContext;
  /** Secretos que no pueden salir en un paso ni en un error (la clave del medidor). */
  readonly secretos?: readonly string[];
};

// ---------------------------------------------------------------------------
// El oficio de Webmaster
// ---------------------------------------------------------------------------

export async function ejecutarTareaWebmaster(input: EjecucionInput): Promise<ResultadoTarea> {
  const { agent, sitio, tarea } = input;
  const simulacion = Boolean(sitio.primerContacto);

  // Dónde se acumulan las capturas de ESTA ejecución. Va en el contexto y no en
  // una variable de módulo: dos tareas del mismo proceso no comparten evidencia.
  const capturas: CapturaEvidencia[] = [];
  const colector: ColectorCapturas = {
    push: (c) => {
      capturas.push({
        herramienta: c.herramienta,
        mimeType: c.mimeType,
        url: c.url,
        titulo: c.titulo,
        base64: c.base64,
      });
    },
  };

  const { velocidad } = input;
  const comun = contextoComun(input, agent, simulacion);
  const contexto: WebmasterContext = {
    ...comun,
    // Las de velocidad exigen sus propios permisos: con la velocidad dentro,
    // el Webmaster los tiene.
    ...(velocidad ? { scopes: [...new Set([...comun.scopes, ...SCOPES_VELOCISTA])] } : {}),
    sitio: { ...sitio, capturas: colector },
    // Las herramientas de velocidad leen `ctx.velocidad`; se lo damos tal cual.
    ...(velocidad ? { velocidad } : {}),
  };

  // El guion de velocidad entero solo cuando el encargo va de eso: el resto del
  // tiempo un aviso de una línea, para no alargar el prompt de cada encargo.
  const textoEncargo = `${tarea.titulo} ${tarea.detalle ?? ""}`;
  const guionVelocidad = !velocidad
    ? ""
    : hablaDeVelocidad(textoEncargo)
      ? BLOQUE_VELOCIDAD_PARA_WEBMASTER
      : AVISO_VELOCIDAD_PARA_WEBMASTER;

  const oficio: OficioDelAgente = {
    ...oficioComun({
      agent,
      herramientas: velocidad ? [...herramientasDe(agent), ...HERRAMIENTAS_VELOCIDAD] : herramientasDe(agent),
      sistema:
        agent.prompt({
          agentName: input.agentName,
          siteUrl: urlVisible(sitio),
          modoSimulacion: simulacion,
        }) + guionVelocidad,
      contexto,
      etiquetaDePaso: (herramienta, entrada) =>
        herramienta.startsWith("velocidad_") ? etiquetaDePasoVelocidad(herramienta) : etiquetaDePaso(herramienta, entrada),
      detalleDePaso: (entrada) => detalleDePaso(entrada) ?? detalleDePasoVelocidad(entrada),
      comun: input,
    }),
    limpiarSecretos: (texto) => limpiarSecretos(texto, sitio, input.secretos),
    describirSolicitud,
    // La misma que calculan las herramientas del Webmaster y con la que la web
    // resuelve las decisiones: si aquí se usara otra, ninguna aprobación se
    // volvería a encontrar y todo lo sensible quedaría colgado. Las de velocidad
    // calculan la suya con su propia función: hay que responderles con esa.
    huella: (toolSlug, entrada) =>
      toolSlug.startsWith("velocidad_")
        ? huellaVelocidad(sitio.taskId, toolSlug, entrada)
        : huellaAccion(sitio.taskId, toolSlug, entrada),
    aprobaciones: sitio.approvals,
    conexionId: sitio.siteId,
    motivoAprobacion: "es una operación de administración del sitio",
    capturas: () => capturas,
  };

  return lanzarOficio(input, oficio, simulacion);
}

// ---------------------------------------------------------------------------
// Utilidades del oficio
// ---------------------------------------------------------------------------

/**
 * Lo que ve el cliente en la tarjeta de aprobación. "wp_instalar_plugin: espera
 * el visto bueno" no dice QUÉ plugin, y aprobar a ciegas no es aprobar.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => String(v ?? "?");
  switch (toolName) {
    case "wp_instalar_plugin":
      return `Instalar y activar el plugin «${texto(e.slug)}».`;
    case "wp_cambiar_plugin":
      return `${e.estado === "active" ? "Activar" : "Desactivar"} el plugin «${texto(e.plugin)}».`;
    case "wp_eliminar_plugin":
      return `Eliminar el plugin «${texto(e.plugin)}».`;
    case "wp_crear_usuario":
      return `Crear el usuario «${texto(e.username)}» (${texto(e.email)}) con el rol ${texto(e.role)}.`;
    case "wp_cambiar_rol_usuario":
      return `Cambiar el rol del usuario ${texto(e.usuario_id)} a ${texto(e.role)}.`;
    default:
      return `${toolName}: ${JSON.stringify(redactSecrets(entrada)).slice(0, 160)}`;
  }
}

/** La URL que el agente puede nombrar. De las credenciales solo sale esto. */
export function urlVisible(sitio: SitioContext): string {
  if (sitio.wp) return sitio.wp.url;
  if (sitio.conector) return sitio.conector.baseUrl.replace(/\/(api\/)?[a-z]+\/v\d+\/?$/, "");
  return "(sitio sin conectar)";
}

/**
 * Última red antes de que un texto llegue al cliente. El filtro de secretos de
 * `@strappy/tools` cubre objetos por nombre de clave; esto cubre el caso de
 * que el modelo haya copiado literalmente una credencial en su respuesta.
 */
export function limpiarSecretos(texto: string, sitio: SitioContext, extra: readonly string[] = []): string {
  const secretos = [sitio.wp?.appPassword, sitio.conector?.token, ...extra].filter(
    (s): s is string => typeof s === "string" && s.length >= 8,
  );
  return secretos.reduce((acc, s) => acc.split(s).join("«oculto»"), texto);
}
