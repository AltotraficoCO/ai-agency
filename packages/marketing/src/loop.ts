/**
 * El agente de Marketing, montado sobre el bucle común de `@strappy/agentes`.
 *
 * El bucle es el mismo que el del Webmaster —y eso es deliberado: el tope de
 * acciones, el freno de repeticiones, el registro en vivo y las aprobaciones ya
 * se pelearon una vez contra sistemas reales—. Lo propio de aquí son las
 * cuentas de publicidad, cómo se cuentan sus pasos y cómo se le explica al
 * cliente lo que va a aprobar.
 *
 * Nada de este archivo sabe hablar con Google, con Meta ni con TikTok: eso son
 * los puertos (`ports.ts`), que en producción rellena el worker con los
 * adaptadores de `adaptadores/` y en los tests rellenan los dobles. Por eso el
 * agente se puede probar entero sin credenciales de ninguna plataforma.
 */
import {
  contextoComun,
  crearTapadera,
  filtrarHerramientas,
  lanzarOficio,
  oficioComun,
  type EntradaComunDeAgente,
  type OficioDelAgente,
  type ResultadoTarea,
} from "@strappy/agentes";
import type { ToolDef } from "@strappy/tools";
import type { MarketingAgentDef } from "./agent.js";
import { huellaAccion } from "./aprobacion.js";
import type { MarketingContext } from "./context.js";
import type { CuentasContext } from "./ports.js";
import { NOMBRE_PLATAFORMA, type Plataforma } from "./ports.js";
import { detalleDePaso, etiquetaDePaso } from "./pasos.js";
import { HERRAMIENTAS_MARKETING } from "./tools/index.js";

export type { PasoTrabajo } from "./pasos.js";

export function herramientasDe(agent: MarketingAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_MARKETING, agent.allowedToolPatterns);
}

/** Lo común a todos los agentes por encargo, más lo que solo tiene este. */
export type EjecucionMarketing = EntradaComunDeAgente & {
  readonly agent: MarketingAgentDef;
  /** Cómo se llama el negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  readonly cuentas: CuentasContext;
  /**
   * Textos que NUNCA pueden salir en un paso, un resumen o un error: los tokens
   * con los que se entra a Google, a Meta y a TikTok.
   *
   * Las credenciales viven dentro del adaptador y no entran al contexto, así
   * que esto es la última red: un error de la plataforma que devolviera la
   * petición entera, o un modelo que copiara algo que vio. Lo inyecta el
   * worker, que es quien las descifra.
   */
  readonly secretos?: readonly string[];
};

export async function ejecutarTareaMarketing(input: EjecucionMarketing): Promise<ResultadoTarea> {
  const { agent, cuentas } = input;
  const simulacion = Boolean(cuentas.primerContacto);

  const contexto: MarketingContext = {
    ...contextoComun(input, agent, simulacion),
    cuentas,
  };

  const oficio: OficioDelAgente = {
    ...oficioComun({
      agent,
      herramientas: herramientasDe(agent),
      sistema: agent.prompt({
        agentName: input.agentName,
        negocio: input.negocio,
        modoSimulacion: simulacion,
      }),
      contexto,
      etiquetaDePaso,
      detalleDePaso,
      comun: input,
    }),
    // Las credenciales de las plataformas nunca entran en el contexto en claro:
    // viven dentro de los adaptadores. No hay nada que tapar en el texto.
    limpiarSecretos: crearTapadera(input.secretos ?? []),
    describirSolicitud,
    // La misma que usan las herramientas de este paquete al pasar por la puerta
    // de aprobación: una decisión guardada tiene que poder encontrarse.
    huella: (toolSlug, entrada) => huellaAccion(cuentas.taskId, toolSlug, entrada),
    aprobaciones: cuentas.approvals,
    conexionId: cuentas.conexionId,
    motivoAprobacion: "cambia cuánto se gasta en publicidad",
  };

  return lanzarOficio(input, oficio, simulacion);
}

/**
 * Lo que lee la persona antes de pulsar Aprobar.
 *
 * Las herramientas que tocan dinero ya escriben su propio resumen con la cifra
 * al mes (ver `tools/cambios.ts`); esto es la red por si el AI SDK corta una
 * llamada antes de que llegue a escribirlo. Aun así se dice la campaña y el
 * dinero, nunca el identificador a secas.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const donde = NOMBRE_PLATAFORMA[e.plataforma as Plataforma] ?? "tu cuenta de anuncios";
  const campana = typeof e.campana_id === "string" ? e.campana_id : "?";
  const motivo = typeof e.motivo === "string" && e.motivo.trim() ? ` Motivo: ${e.motivo}` : "";
  switch (toolName) {
    case "ads_cambiar_presupuesto":
      return `Cambiar a ${String(e.diario ?? "?")} al día el presupuesto de la campaña ${campana} en ${donde}.${motivo}`;
    case "ads_pausar_campana":
      return `Pausar la campaña ${campana} en ${donde}: deja de gastar y de mostrarse.${motivo}`;
    case "ads_activar_campana":
      return `Reactivar la campaña ${campana} en ${donde}: vuelve a gastar.${motivo}`;
    default:
      return `${toolName}: ${JSON.stringify(entrada).slice(0, 160)}`;
  }
}
