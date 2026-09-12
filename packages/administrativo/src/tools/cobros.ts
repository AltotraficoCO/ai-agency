/**
 * Perseguir lo que deben, sin enviar nada.
 *
 * Este agente redacta el recordatorio y lo entrega; quien habla con los
 * clientes es el agente de Comunicaciones, que ya tiene WhatsApp conectado, la
 * bandeja y el historial de la conversación. Pedro lo dijo así: «si hay una
 * factura atrasada, le habla por WhatsApp y tenemos un agente que cobra; se
 * integran los agentes».
 *
 * Que el envío viva en otro departamento no es burocracia: un mensaje a un
 * cliente del cliente sale de un número que ya existe, con un historial detrás,
 * y quien lo gestiona es quien atiende la respuesta.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { importeLegible, pendientes, textoDeRecordatorio } from "../analisis.js";
import { requireContabilidad } from "../ports.js";
import { entorno } from "./comun.js";

export const adminPrepararRecordatorio = defineTool({
  slug: "admin_preparar_recordatorio",
  label: "Escribir un recordatorio de cobro",
  description:
    "Escribe el mensaje para recordarle a un cliente una factura sin pagar, con el número y el importe. NO lo envía: lo entrega para que lo mande el agente que habla con los clientes.",
  whenToUse: "cuando el cliente quiera cobrar una factura concreta y necesite el mensaje ya redactado",
  inputSchema: z.object({
    factura_numero: z.string().min(1).describe("Número de la factura que se va a recordar."),
    negocio: z
      .string()
      .min(2)
      .max(120)
      .describe("Nombre del negocio que cobra, tal y como lo conocen sus clientes."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_preparar_recordatorio");
    const contabilidad = requireContabilidad(libros, "admin_preparar_recordatorio");
    const moneda = await contabilidad.monedaBase();
    const abiertas = await contabilidad.facturas({ estado: "abierta" });
    const lista = pendientes(abiertas, ctx.now());
    const encontrada = lista.find((p) => p.factura.numero === input.factura_numero);
    if (!encontrada) {
      throw new Error(
        `No encuentro ninguna factura sin pagar con el número ${input.factura_numero}. Compruébalo con admin_facturas_por_cobrar.`,
      );
    }

    const texto = textoDeRecordatorio(encontrada, input.negocio);
    return {
      texto,
      cliente: encontrada.factura.cliente.nombre,
      cliente_id: encontrada.factura.cliente.id,
      factura: encontrada.factura.numero,
      falta_por_cobrar: importeLegible(encontrada.factura.saldo, moneda),
      dias_de_atraso: encontrada.dias > 0 ? encontrada.dias : 0,
      enviado: false,
      nota: libros.mensajeria
        ? `Escrito, no enviado. Puede mandarlo el agente que atiende por ${libros.mensajeria.canal}.`
        : "Escrito, no enviado. Entrégaselo al cliente en el RESUMEN, o que lo mande el agente de WhatsApp si lo tiene contratado.",
    };
  },
});

export const HERRAMIENTAS_COBROS: readonly ToolDef<never, unknown>[] = [
  adminPrepararRecordatorio,
] as unknown as readonly ToolDef<never, unknown>[];
