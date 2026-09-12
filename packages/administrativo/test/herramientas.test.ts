/**
 * Las herramientas, contra el doble del sistema contable.
 *
 * La promesa que se verifica aquí es una sola y es la que sostiene el producto:
 * el agente NO puede dejar un papel en la contabilidad del cliente sin que una
 * persona pulse un botón. Después, que no saque más datos de terceros de los
 * necesarios.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import {
  adminBuscarCliente,
  adminEmitirFactura,
  adminEstadoDeCaja,
  adminFacturasPorCobrar,
  adminPrepararRecordatorio,
  adminRegistrarPago,
  HERRAMIENTAS_ADMINISTRATIVO,
} from "../src/tools/index.js";
import { huellaAccion } from "../src/aprobacion.js";
import { SCOPES_ADMINISTRATIVO } from "../src/context.js";
import { etiquetaDePaso } from "../src/pasos.js";
import type { LibrosContext } from "../src/ports.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  ContabilidadEnMemoria,
  MensajeriaEnMemoria,
} from "../src/testing/dobles.js";

const AHORA = new Date("2026-09-12T15:00:00.000Z");

function montar(o: { contabilidad?: ContabilidadEnMemoria; conMensajeria?: boolean } = {}) {
  const contabilidad = o.contabilidad ?? new ContabilidadEnMemoria();
  const approvals = new AprobacionesEnMemoria();
  const backups = new BackupsEnMemoria();
  const mensajeria = new MensajeriaEnMemoria();
  const libros: LibrosContext = {
    conexionId: "con_1",
    taskId: "task_1",
    contabilidad,
    ...(o.conMensajeria ? { mensajeria } : {}),
    approvals,
    backups,
  };
  const ctx = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_ADMINISTRATIVO,
    ports: {},
    now: () => AHORA,
    libros,
  } as unknown as ToolContext;
  return { ctx, contabilidad, approvals, backups, mensajeria, libros };
}

describe("mirar", () => {
  it("dice cuánto le deben, cuánto está vencido y cuánto entró", async () => {
    const { ctx } = montar();
    const r = (await adminEstadoDeCaja.execute(ctx, { dias: 30 })) as {
      te_deben: string;
      facturas_vencidas: number;
      resumen_legible: string;
      lo_mas_urgente: string[];
    };
    expect(r.facturas_vencidas).toBe(3);
    expect(r.resumen_legible).toContain("Te deben");
    expect(r.lo_mas_urgente[0]).toContain("Constructora del Valle");
  });

  it("sin sistema contable conectado lo dice en vez de fallar con un error técnico", async () => {
    const { ctx } = montar();
    const sinConexion = {
      ...ctx,
      libros: { ...(ctx as never as { libros: LibrosContext }).libros, contabilidad: undefined },
    };
    await expect(
      adminEstadoDeCaja.execute(sinConexion as unknown as ToolContext, { dias: 30 }),
    ).rejects.toThrow(/facturación conectado/i);
  });

  it("una conexión de solo lectura lo avisa", async () => {
    const { ctx } = montar({ contabilidad: new ContabilidadEnMemoria({ puedeEscribir: false }) });
    const r = (await adminEstadoDeCaja.execute(ctx, { dias: 30 })) as { nota?: string };
    expect(r.nota).toContain("solo lectura");
  });

  it("no baja más facturas de las que va a nombrar, y dice cuántas quedan", async () => {
    const { ctx } = montar();
    const r = (await adminFacturasPorCobrar.execute(ctx, { cuantas: 2, solo_vencidas: false })) as {
      facturas: unknown[];
      cuantas_hay: number;
      nota?: string;
    };
    expect(r.facturas).toHaveLength(2);
    expect(r.cuantas_hay).toBe(4);
    expect(r.nota).toContain("no se listan");
  });

  it("puede mirar solo las vencidas", async () => {
    const { ctx } = montar();
    const r = (await adminFacturasPorCobrar.execute(ctx, { cuantas: 10, solo_vencidas: true })) as {
      cuantas_hay: number;
    };
    expect(r.cuantas_hay).toBe(3);
  });

  it("al buscar un cliente que no existe, no lo inventa", async () => {
    const { ctx } = montar();
    const r = (await adminBuscarCliente.execute(ctx, { texto: "Zzz" })) as {
      clientes: unknown[];
      nota?: string;
    };
    expect(r.clientes).toHaveLength(0);
    expect(r.nota).toContain("no lo adivines");
  });
});

describe("nada se emite sin que una persona lo apruebe", () => {
  it("emitir una factura primero pide aprobación y no crea nada", async () => {
    const { ctx, contabilidad, approvals } = montar();
    const entrada = {
      cliente_id: "cli_1",
      moneda: "COP",
      lineas: [{ descripcion: "Servicio de mantenimiento", cantidad: 1, precio: 1_200_000, impuesto_porcentaje: 19 }],
    };
    const r = (await adminEmitirFactura.execute(ctx, entrada)) as { requiere_aprobacion?: boolean };
    expect(r.requiere_aprobacion).toBe(true);
    expect(contabilidad.escrituras()).toBe(0);
    expect(approvals.solicitudes[0]?.resumen).toContain("Distribuciones Pérez");
  });

  it("la aprobación se lee en dinero, con impuestos incluidos", async () => {
    const { ctx, approvals } = montar();
    await adminEmitirFactura.execute(ctx, {
      cliente_id: "cli_1",
      moneda: "COP",
      lineas: [{ descripcion: "Consultoría", cantidad: 2, precio: 500_000, impuesto_porcentaje: 19 }],
    });
    const resumen = approvals.solicitudes[0]?.resumen ?? "";
    expect(resumen).toContain("1.190.000");
    expect(resumen).toContain("Consultoría");
  });

  it("con la aprobación dada, emite y guarda copia de lo que hizo", async () => {
    const { ctx, contabilidad, approvals, backups } = montar();
    approvals.apruebaTodo = true;
    const r = (await adminEmitirFactura.execute(ctx, {
      cliente_id: "cli_1",
      moneda: "COP",
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio: 300_000, impuesto_porcentaje: 0 }],
    })) as { emitida?: boolean; cliente?: string };
    expect(r.emitida).toBe(true);
    expect(r.cliente).toBe("Distribuciones Pérez");
    expect(contabilidad.escrituras()).toBe(1);
    expect(backups.guardados[0]?.alcance).toContain("factura_emitida");
  });

  it("una aprobación vale solo para lo aprobado: cambiar el importe vuelve a preguntar", async () => {
    const { ctx, approvals } = montar();
    const entrada = {
      cliente_id: "cli_1",
      moneda: "COP",
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio: 300_000, impuesto_porcentaje: 0 }],
    };
    approvals.decidir(huellaAccion("task_1", "admin_emitir_factura", entrada), "aprobada");
    const otra = { ...entrada, lineas: [{ ...entrada.lineas[0]!, precio: 3_000_000 }] };
    const r = (await adminEmitirFactura.execute(ctx, otra)) as { requiere_aprobacion?: boolean };
    expect(r.requiere_aprobacion).toBe(true);
  });

  it("si el cliente lo rechazó, no se insiste", async () => {
    const { ctx, contabilidad, approvals } = montar();
    const entrada = {
      cliente_id: "cli_1",
      moneda: "COP",
      lineas: [{ descripcion: "Servicio", cantidad: 1, precio: 300_000, impuesto_porcentaje: 0 }],
    };
    approvals.decidir(huellaAccion("task_1", "admin_emitir_factura", entrada), "rechazada");
    const r = (await adminEmitirFactura.execute(ctx, entrada)) as { aprobacion_rechazada?: boolean };
    expect(r.aprobacion_rechazada).toBe(true);
    expect(contabilidad.escrituras()).toBe(0);
  });

  it("con la conexión en solo lectura, no se puede emitir y se explica por qué", async () => {
    const { ctx } = montar({ contabilidad: new ContabilidadEnMemoria({ puedeEscribir: false }) });
    await expect(
      adminEmitirFactura.execute(ctx, {
        cliente_id: "cli_1",
        moneda: "COP",
        lineas: [{ descripcion: "Servicio", cantidad: 1, precio: 300_000, impuesto_porcentaje: 0 }],
      }),
    ).rejects.toThrow(/solo lectura/i);
  });
});

describe("registrar un pago", () => {
  it("pide aprobación antes de tocar nada", async () => {
    const { ctx, contabilidad, approvals } = montar();
    const r = (await adminRegistrarPago.execute(ctx, {
      factura_numero: "FV-1042",
      importe: 4_252_000,
      moneda: "COP",
    })) as { requiere_aprobacion?: boolean };
    expect(r.requiere_aprobacion).toBe(true);
    expect(contabilidad.escrituras()).toBe(0);
    expect(approvals.solicitudes[0]?.resumen).toContain("FV-1042");
  });

  it("no registra un pago mayor que lo que falta por cobrar", async () => {
    const { ctx } = montar();
    await expect(
      adminRegistrarPago.execute(ctx, { factura_numero: "FV-1042", importe: 99_000_000, moneda: "COP" }),
    ).rejects.toThrow(/mayor que lo que falta/i);
  });

  it("no registra un pago de una factura que no existe", async () => {
    const { ctx } = montar();
    await expect(
      adminRegistrarPago.execute(ctx, { factura_numero: "FV-9999", importe: 1_000, moneda: "COP" }),
    ).rejects.toThrow(/No encuentro/i);
  });

  it("aprobado, lo registra y deja la factura saldada", async () => {
    const { ctx, contabilidad, approvals } = montar();
    approvals.apruebaTodo = true;
    const r = (await adminRegistrarPago.execute(ctx, {
      factura_numero: "FV-1042",
      importe: 4_252_000,
      moneda: "COP",
      cuenta_bancaria: "Corriente Bancolombia",
    })) as { registrado?: boolean };
    expect(r.registrado).toBe(true);
    const abiertas = await contabilidad.facturas({ estado: "abierta" });
    expect(abiertas.map((f) => f.numero)).not.toContain("FV-1042");
  });
});

describe("el recordatorio se escribe, no se envía", () => {
  it("devuelve el texto y deja claro que no salió", async () => {
    const { ctx, mensajeria } = montar({ conMensajeria: true });
    const r = (await adminPrepararRecordatorio.execute(ctx, {
      factura_numero: "FV-1001",
      negocio: "Altotráfico",
    })) as { enviado: boolean; texto: string; nota?: string };
    expect(r.enviado).toBe(false);
    expect(r.texto).toContain("FV-1001");
    expect(mensajeria.enviados).toHaveLength(0);
    expect(r.nota).toContain("no enviado");
  });

  it("de una factura que no existe, no se inventa el mensaje", async () => {
    const { ctx } = montar();
    await expect(
      adminPrepararRecordatorio.execute(ctx, { factura_numero: "FV-0000", negocio: "Altotráfico" }),
    ).rejects.toThrow(/No encuentro/i);
  });
});

describe("el registro de trabajo y el catálogo de herramientas", () => {
  it("las ocho herramientas están registradas y ninguna pide datos del runtime", () => {
    // 8 del Administrativo + el informe del negocio, que usa el de Reportes.
    expect(HERRAMIENTAS_ADMINISTRATIVO).toHaveLength(9);
    for (const h of HERRAMIENTAS_ADMINISTRATIVO) {
      expect(h.slug).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("cada paso se cuenta en lenguaje del dueño, sin jerga contable", () => {
    for (const h of HERRAMIENTAS_ADMINISTRATIVO) {
      const etiqueta = etiquetaDePaso(h.slug);
      expect(etiqueta.toLowerCase()).not.toMatch(/cartera|cxc|conciliaci|causaci|api|alegra/);
    }
    expect(etiquetaDePaso("admin_estado_de_caja")).toBe("Revisando cuánto te deben y cuánto entró");
  });
});
