/**
 * El agente Administrativo, montado sobre el bucle común de `@strappy/agentes`.
 *
 * El bucle es el mismo que el del Webmaster y el de Marketing —el tope de
 * acciones, el freno de repeticiones, el registro en vivo y las aprobaciones ya
 * se pelearon una vez contra sistemas reales—. Lo propio de aquí son los libros
 * del negocio, cómo se cuentan sus pasos y, sobre todo, cómo se le explica a la
 * persona lo que va a aprobar: son documentos legales.
 *
 * Nada de este archivo sabe hablar con Alegra: eso es el adaptador, detrás del
 * puerto de contabilidad. Por eso el agente se puede probar entero sin las
 * credenciales del sistema contable del cliente.
 */
import type { LanguageModel, ModelMessage, ToolApprovalResponse } from "ai";
import {
  bloqueDeCompaneros,
  ejecutarTareaDeAgente,
  filtrarHerramientas,
  type ColaboracionPort,
  type Companero,
  type OficioDelAgente,
  type ResultadoTarea,
  type TareaEncargo,
} from "@strappy/agentes";
import type { ToolDef } from "@strappy/tools";
import type { RateTable } from "@strappy/core";
import type { AdministrativoAgentDef } from "./agent.js";
import { huellaAccion } from "./aprobacion.js";
import type { AdministrativoContext } from "./context.js";
import type { LibrosContext } from "./ports.js";
import { detalleDePaso, etiquetaDePaso } from "./pasos.js";
import { HERRAMIENTAS_ADMINISTRATIVO } from "./tools/index.js";

export type { PasoTrabajo } from "./pasos.js";

export function herramientasDe(agent: AdministrativoAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_ADMINISTRATIVO, agent.allowedToolPatterns);
}

export type EjecucionAdministrativo = {
  readonly agent: AdministrativoAgentDef;
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly rates: RateTable;
  readonly workspaceId: string;
  readonly agentId?: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Cómo se llama el negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  readonly libros: LibrosContext;
  readonly tarea: TareaEncargo;
  readonly mensajesPrevios?: readonly ModelMessage[];
  readonly aprobaciones?: readonly ToolApprovalResponse[];
  readonly abortSignal?: AbortSignal;
  readonly onEvento?: (mensaje: string) => void;
  readonly alAvanzar?: (paso: import("./pasos.js").PasoTrabajo) => void;
  /** Compañeros contratados a los que puede pedir ayuda. Vacío: trabaja solo. */
  readonly companeros?: readonly Companero[];
  /** Quién ejecuta el encargo del compañero. Sin esto no se puede delegar. */
  readonly colaboracion?: ColaboracionPort;
  /** Agentes que ya intervinieron en esta cadena. Vacío si lo pidió una persona. */
  readonly cadena?: readonly string[];
  /**
   * Textos que NUNCA pueden salir en un paso, un resumen o un error: el token
   * de la API del sistema contable y el usuario con el que se conecta.
   *
   * Las credenciales viven dentro del adaptador y no entran al contexto, así
   * que esto es la última red: un mensaje de error del proveedor que devolviera
   * la cabecera de autenticación, o un modelo que copiara algo que vio. Se
   * inyecta desde el worker, que es quien las descifra.
   */
  readonly secretos?: readonly string[];
};

export async function ejecutarTareaAdministrativa(
  input: EjecucionAdministrativo,
): Promise<ResultadoTarea> {
  const { agent, libros, tarea } = input;
  const simulacion = Boolean(libros.primerContacto);

  const contexto: AdministrativoContext = {
    workspaceId: input.workspaceId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    agentRunId: tarea.id,
    dryRun: simulacion,
    scopes: agent.scopes,
    ports: {},
    now: () => new Date(),
    libros,
  };

  const tapar = crearTapadera(input.secretos ?? []);

  const oficio: OficioDelAgente = {
    slug: agent.slug,
    herramientas: herramientasDe(agent),
    maxAcciones: agent.maxAcciones,
    timeoutMs: agent.timeoutMs,
    sistema:
      agent.prompt({
        agentName: input.agentName,
        negocio: input.negocio,
        modoSimulacion: simulacion,
      }) + bloqueDeCompaneros(input.companeros ?? []),
    contexto,
    ...(input.colaboracion ? { colaboracion: input.colaboracion } : {}),
    ...(input.cadena ? { cadena: input.cadena } : {}),
    etiquetaDePaso,
    detalleDePaso,
    limpiarSecretos: tapar,
    describirSolicitud,
    // La misma que usan las herramientas de este paquete al pasar por la puerta
    // de aprobación: una decisión guardada tiene que poder encontrarse.
    huella: (toolSlug, entrada) => huellaAccion(libros.taskId, toolSlug, entrada),
    aprobaciones: libros.approvals,
    conexionId: libros.conexionId || null,
    motivoAprobacion: "deja un papel en la contabilidad del negocio",
  };

  return ejecutarTareaDeAgente({
    oficio,
    model: input.model,
    modelId: input.modelId,
    rates: input.rates,
    workspaceId: input.workspaceId,
    tarea,
    simulacion,
    ...(input.mensajesPrevios ? { mensajesPrevios: input.mensajesPrevios } : {}),
    ...(input.aprobaciones ? { aprobaciones: input.aprobaciones } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(input.onEvento ? { onEvento: input.onEvento } : {}),
    ...(input.alAvanzar ? { alAvanzar: input.alAvanzar } : {}),
  });
}

/** Cabecera de autenticación básica, por si un error del proveedor la devuelve. */
const AUTORIZACION = /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{8,}/gi;

/**
 * Tapa las credenciales antes de que un texto llegue al cliente.
 *
 * Se tapan los secretos conocidos —el token de la API y el usuario— y cualquier
 * cabecera de autenticación. No es paranoia: el adaptador incluye el cuerpo de
 * la respuesta del sistema contable en sus errores, y ese cuerpo lo escribe un
 * tercero.
 */
export function crearTapadera(secretos: readonly string[]): (texto: string) => string {
  const utiles = secretos.filter((s) => typeof s === "string" && s.trim().length >= 6);
  return (texto: string): string => {
    let salida = texto.replace(AUTORIZACION, "$1 ***");
    for (const secreto of utiles) salida = salida.split(secreto).join("***");
    return salida;
  };
}

/**
 * Lo que lee la persona antes de pulsar Aprobar.
 *
 * Las herramientas que tocan la contabilidad ya escriben su propio resumen con
 * el importe y el nombre del cliente (ver `tools/documentos.ts`); esto es la red
 * por si el AI SDK corta una llamada antes de que llegue a escribirlo. Aun así
 * se dice el dinero y a quién, nunca un identificador a secas.
 *
 * Y en una factura de venta se avisa de lo que casi nadie piensa hasta que pasa:
 * según cómo esté configurada la cuenta, emitirla puede mandarla a la DIAN, y
 * entonces ya no es un borrador que se borra sino un documento que hay que
 * anular con su nota de crédito.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const moneda = typeof e.moneda === "string" ? e.moneda : "";
  switch (toolName) {
    case "admin_emitir_factura": {
      const lineas = Array.isArray(e.lineas) ? e.lineas : [];
      const total = lineas.reduce((suma: number, l) => {
        const linea = (l ?? {}) as Record<string, unknown>;
        const cantidad = typeof linea.cantidad === "number" ? linea.cantidad : 0;
        const precio = typeof linea.precio === "number" ? linea.precio : 0;
        const impuesto =
          typeof linea.impuesto_porcentaje === "number" ? linea.impuesto_porcentaje : 0;
        return suma + cantidad * precio * (1 + impuesto / 100);
      }, 0);
      const concepto = lineas
        .map((l) => String(((l ?? {}) as Record<string, unknown>).descripcion ?? ""))
        .filter(Boolean)
        .join("; ");
      return (
        `Emitir una factura${total > 0 ? ` de ${Math.round(total).toLocaleString("es-CO")} ${moneda}` : ""}` +
        ` al cliente ${String(e.cliente_id ?? "?")}.` +
        (concepto ? ` Concepto: ${concepto}.` : "") +
        ` Es un documento legal en tu contabilidad: según cómo tengas configurada tu cuenta, puede enviarse a la DIAN y entonces solo se deshace con una nota de crédito.`
      );
    }
    case "admin_registrar_pago":
      return (
        `Registrar un pago de ${String(e.importe ?? "?")} ${moneda} ` +
        `para la factura ${String(e.factura_numero ?? "?")} en tu contabilidad.`
      );
    default:
      return `${toolName}: ${JSON.stringify(entrada).slice(0, 160)}`;
  }
}
