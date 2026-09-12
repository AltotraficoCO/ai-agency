/**
 * Lo que deja un papel en la contabilidad del cliente. Nada de esto se ejecuta solo.
 *
 * Las dos herramientas de aquí pasan SIEMPRE por la puerta de aprobación, y el
 * texto que ve la persona dice el importe y el nombre del cliente, porque eso
 * es lo que permite decidir en un segundo si está bien o mal. Un identificador
 * de documento no le dice nada a nadie.
 *
 * Además se guarda el estado anterior como backup antes de tocar nada: sin eso,
 * deshacer no es un botón sino una llamada al contador.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { dinero, fecha, totalDelBorrador } from "../analisis.js";
import { puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import { exigirEscritura, requireContabilidad } from "../ports.js";
import { entorno } from "./comun.js";

const moneda = z
  .string()
  .length(3)
  .toUpperCase()
  .describe("Moneda de la factura en tres letras: COP, USD…");

export const adminEmitirFactura = defineTool({
  slug: "admin_emitir_factura",
  label: "Emitir una factura",
  description:
    "Emite una factura de venta a un cliente. Deja un documento legal en la contabilidad: SIEMPRE requiere que una persona lo apruebe.",
  whenToUse:
    "cuando el cliente te diga a quién facturar y por qué concepto, y ya hayas confirmado el cliente con admin_buscar_cliente",
  inputSchema: z.object({
    cliente_id: z.string().min(1).describe("Identificador del cliente, de admin_buscar_cliente."),
    moneda,
    lineas: z
      .array(
        z.object({
          descripcion: z.string().min(2).max(300),
          cantidad: z.number().positive(),
          precio: z.number().nonnegative().describe("Precio unitario, sin impuesto."),
          impuesto_porcentaje: z
            .number()
            .min(0)
            .max(100)
            .default(0)
            .describe("Porcentaje de impuesto de esa línea. 0 si no lleva."),
        }),
      )
      .min(1)
      .max(30),
    vence: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Fecha de vencimiento, AAAA-MM-DD. Si falta, la pone el sistema contable."),
    nota: z.string().max(500).optional(),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.contabilidadWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { libros, workspaceId } = entorno(ctx, "admin_emitir_factura");
    const contabilidad = requireContabilidad(libros, "admin_emitir_factura");
    exigirEscritura(contabilidad, "admin_emitir_factura");

    const lineas = input.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio: l.precio,
      impuestoPorcentaje: l.impuesto_porcentaje,
    }));
    const cuentas = totalDelBorrador(lineas);

    const clientes = await contabilidad.buscarClientes({ texto: "", limite: 0 }).catch(() => []);
    const nombre = clientes.find((c) => c.id === input.cliente_id)?.nombre ?? `el cliente ${input.cliente_id}`;

    const bloqueo = await puertaDeAprobacion({
      approvals: libros.approvals,
      workspaceId,
      taskId: libros.taskId,
      conexionId: libros.conexionId,
      toolSlug: "admin_emitir_factura",
      motivo: "emite un documento legal en tu contabilidad",
      resumen:
        `Facturar ${dinero(cuentas.total, input.moneda)} a ${nombre}` +
        (cuentas.impuestos > 0
          ? ` (${dinero(cuentas.subtotal, input.moneda)} más ${dinero(cuentas.impuestos, input.moneda)} de impuestos)`
          : "") +
        `. Concepto: ${input.lineas.map((l) => l.descripcion).join("; ")}.`,
      entrada: input,
    });
    if (bloqueo) return bloqueo;

    const factura = await contabilidad.crearFactura({
      clienteId: input.cliente_id,
      moneda: input.moneda,
      lineas,
      ...(input.vence ? { vence: input.vence } : {}),
      ...(input.nota ? { nota: input.nota } : {}),
    });

    if (libros.backups) {
      await libros.backups.create({
        workspaceId,
        siteId: libros.conexionId,
        taskId: libros.taskId,
        alcance: `factura_emitida:${factura.id}`,
        snapshot: { facturaId: factura.id, numero: factura.numero, total: factura.total },
      });
    }

    return {
      emitida: true,
      numero: factura.numero,
      cliente: factura.cliente.nombre,
      total: dinero(factura.total.valor, factura.total.moneda),
      vence: factura.vence,
    };
  },
  simulate(_ctx, input) {
    const cuentas = totalDelBorrador(
      input.lineas.map((l) => ({
        cantidad: l.cantidad,
        precio: l.precio,
        impuestoPorcentaje: l.impuesto_porcentaje,
      })),
    );
    return {
      simulado: true,
      nota: "Simulación: la factura NO se emitió. Descríbela en el plan y deja que el cliente decida.",
      cliente_id: input.cliente_id,
      total: dinero(cuentas.total, input.moneda),
    };
  },
});

export const adminRegistrarPago = defineTool({
  slug: "admin_registrar_pago",
  label: "Registrar un pago",
  description:
    "Registra un pago recibido y lo aplica a una factura. Toca la contabilidad: SIEMPRE requiere que una persona lo apruebe.",
  whenToUse: "cuando el cliente te diga que le pagaron una factura y quiera dejarlo registrado",
  inputSchema: z.object({
    factura_numero: z.string().min(1).describe("Número de la factura que se está pagando."),
    importe: z.number().positive(),
    moneda,
    fecha_pago: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("AAAA-MM-DD. Si falta, hoy."),
    cuenta_bancaria: z
      .string()
      .max(80)
      .optional()
      .describe("Dónde entró el dinero, como lo llama el sistema contable."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.contabilidadWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { libros, workspaceId } = entorno(ctx, "admin_registrar_pago");
    const contabilidad = requireContabilidad(libros, "admin_registrar_pago");
    exigirEscritura(contabilidad, "admin_registrar_pago");

    const abiertas = await contabilidad.facturas({ estado: "abierta" });
    const factura = abiertas.find((f) => f.numero === input.factura_numero);
    if (!factura) {
      throw new Error(
        `No encuentro ninguna factura sin pagar con el número ${input.factura_numero}. Compruébalo con admin_facturas_por_cobrar.`,
      );
    }
    if (input.importe > factura.saldo.valor) {
      throw new Error(
        `El pago (${dinero(input.importe, input.moneda)}) es mayor que lo que falta por cobrar de la factura ${factura.numero} (${dinero(factura.saldo.valor, factura.saldo.moneda)}). Confírmalo con el cliente antes de registrarlo.`,
      );
    }

    const bloqueo = await puertaDeAprobacion({
      approvals: libros.approvals,
      workspaceId,
      taskId: libros.taskId,
      conexionId: libros.conexionId,
      toolSlug: "admin_registrar_pago",
      motivo: "registra dinero recibido en tu contabilidad",
      resumen:
        `Registrar un pago de ${dinero(input.importe, input.moneda)} de ${factura.cliente.nombre} ` +
        `para la factura ${factura.numero}, que tiene pendiente ${dinero(factura.saldo.valor, factura.saldo.moneda)}.`,
      entrada: input,
    });
    if (bloqueo) return bloqueo;

    if (libros.backups) {
      await libros.backups.create({
        workspaceId,
        siteId: libros.conexionId,
        taskId: libros.taskId,
        alcance: `factura_saldo:${factura.id}`,
        snapshot: { facturaId: factura.id, numero: factura.numero, saldo: factura.saldo },
      });
    }

    const cobro = await contabilidad.registrarCobro({
      facturaId: factura.id,
      importe: input.importe,
      moneda: input.moneda,
      fecha: input.fecha_pago ?? fecha(ctx.now()),
      ...(input.cuenta_bancaria ? { cuentaId: input.cuenta_bancaria } : {}),
    });

    return {
      registrado: true,
      factura: factura.numero,
      cliente: factura.cliente.nombre,
      importe: dinero(cobro.importe.valor, cobro.importe.moneda),
      fecha: cobro.fecha,
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      nota: "Simulación: el pago NO se registró. Descríbelo en el plan.",
      factura_numero: input.factura_numero,
      importe: dinero(input.importe, input.moneda),
    };
  },
});

export const HERRAMIENTAS_DOCUMENTOS: readonly ToolDef<never, unknown>[] = [
  adminEmitirFactura,
  adminRegistrarPago,
] as unknown as readonly ToolDef<never, unknown>[];
