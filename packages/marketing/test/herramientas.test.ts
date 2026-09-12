/**
 * Las herramientas, contra los dobles de las plataformas.
 *
 * La promesa que se verifica aquí es una sola y es la que sostiene el producto:
 * el agente NO puede gastar dinero del cliente sin que una persona pulse un
 * botón. Todo lo demás (que formatee bien, que explique) importa menos que eso.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import {
  adsCambiarPresupuesto,
  adsListarCuentas,
  adsPausarCampana,
  adsRevisarCampanas,
  analyticsResumenWeb,
} from "../src/tools/index.js";
import { huellaAccion } from "../src/aprobacion.js";
import { SCOPES_MARKETING } from "../src/context.js";
import type { CuentasContext } from "../src/ports.js";
import {
  AdsEnMemoria,
  AnalyticsEnMemoria,
  AprobacionesEnMemoria,
  BackupsEnMemoria,
} from "../src/testing/dobles.js";

const AHORA = new Date("2026-09-12T10:00:00.000Z");

function montar(o: { ads?: AdsEnMemoria; conAnalytics?: boolean } = {}) {
  const ads = o.ads ?? new AdsEnMemoria();
  const approvals = new AprobacionesEnMemoria();
  const backups = new BackupsEnMemoria();
  const cuentas: CuentasContext = {
    conexionId: "con_1",
    taskId: "task_1",
    ads: [ads],
    ...(o.conAnalytics === false ? {} : { analytics: new AnalyticsEnMemoria() }),
    approvals,
    backups,
  };
  const ctx = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_MARKETING,
    ports: {},
    now: () => AHORA,
    cuentas,
  } as unknown as ToolContext;
  return { ctx, ads, approvals, backups, cuentas };
}

describe("mirar", () => {
  it("lista las cuentas y dice si puede cambiar cosas en ellas", async () => {
    const { ctx } = montar();
    const r = (await adsListarCuentas.execute(ctx, {})) as {
      cuentas: { plataforma_nombre: string; moneda: string; puedo_cambiar_cosas: boolean }[];
    };
    expect(r.cuentas[0]?.plataforma_nombre).toBe("Google Ads");
    expect(r.cuentas[0]?.moneda).toBe("COP");
    expect(r.cuentas[0]?.puedo_cambiar_cosas).toBe(true);
  });

  it("sin ninguna plataforma conectada lo dice, en vez de fallar", async () => {
    const { ctx } = montar();
    const vacio = { ...ctx, cuentas: { ...(ctx as never as { cuentas: CuentasContext }).cuentas, ads: [] } };
    const r = (await adsListarCuentas.execute(vacio as unknown as ToolContext, {})) as { nota?: string };
    expect(r.nota).toContain("No hay ninguna plataforma");
  });

  it("el periodo por defecto termina ayer, no hoy", async () => {
    const { ctx } = montar();
    const r = (await adsRevisarCampanas.execute(ctx, {
      plataforma: "google_ads",
      cuenta_id: "acc_1",
      dias: 7,
    })) as { periodo: { desde: string; hasta: string } };
    expect(r.periodo.hasta).toBe("2026-09-11");
    expect(r.periodo.desde).toBe("2026-09-05");
  });

  it("devuelve las cifras ya escritas en la moneda del cliente y los hallazgos", async () => {
    const { ctx } = montar();
    const r = (await adsRevisarCampanas.execute(ctx, {
      plataforma: "google_ads",
      cuenta_id: "acc_1",
      dias: 7,
    })) as {
      resumen_legible: string;
      total: { gasto: string };
      hallazgos: { severidad: string }[];
    };
    expect(r.total.gasto).toContain("630.000");
    expect(r.resumen_legible).toContain("invertiste");
    expect(r.hallazgos.some((h) => h.severidad === "grave")).toBe(true);
  });

  it("una cuenta que no está conectada da un error que dice qué hacer", async () => {
    const { ctx } = montar();
    await expect(
      adsRevisarCampanas.execute(ctx, { plataforma: "google_ads", cuenta_id: "otra", dias: 7 }),
    ).rejects.toThrow(/ads_listar_cuentas/);
  });

  it("resume la web por canal", async () => {
    const { ctx } = montar();
    const r = (await analyticsResumenWeb.execute(ctx, { dias: 7 })) as {
      visitas: number;
      de_donde_llegan: { canal: string; parte: string }[];
    };
    expect(r.visitas).toBe(1_240);
    expect(r.de_donde_llegan[0]?.parte).toBe("42%");
  });
});

describe("el dinero no se toca sin permiso", () => {
  it("cambiar el presupuesto sin aprobación no cambia nada", async () => {
    const { ctx, ads, approvals } = montar();
    const r = (await adsCambiarPresupuesto.execute(ctx, {
      plataforma: "google_ads",
      cuenta_id: "acc_1",
      campana_id: "c_buena",
      diario: 60_000,
      motivo: "es la que mejor funciona: trae clientes a 15.000 pesos",
    })) as { requiere_aprobacion?: boolean };

    expect(r.requiere_aprobacion).toBe(true);
    expect(ads.escrituras()).toBe(0);
    expect(approvals.solicitudes).toHaveLength(1);
  });

  it("lo que lee la persona antes de aprobar dice cuánto es al mes", async () => {
    const { ctx, approvals } = montar();
    await adsCambiarPresupuesto.execute(ctx, {
      plataforma: "google_ads",
      cuenta_id: "acc_1",
      campana_id: "c_buena",
      diario: 50_000,
      motivo: "es la que mejor funciona: trae clientes a 15.000 pesos",
    });
    const resumen = approvals.solicitudes[0]?.resumen ?? "";
    expect(resumen).toContain("600.000");
    expect(resumen).toContain("más al mes");
    expect(resumen).toContain("Motivo:");
  });

  it("con la aprobación dada, se aplica y queda backup del valor anterior", async () => {
    const { ctx, ads, backups } = montar();
    const entrada = {
      plataforma: "google_ads" as const,
      cuenta_id: "acc_1",
      campana_id: "c_buena",
      diario: 60_000,
      motivo: "es la que mejor funciona: trae clientes a 15.000 pesos",
    };
    const { approvals } = montar();
    void approvals;
    // Una persona ya aprobó exactamente esta acción.
    const aprobaciones = (ctx as unknown as { cuentas: { approvals: AprobacionesEnMemoria } }).cuentas.approvals;
    aprobaciones.decidir(huellaAccion("task_1", "ads_cambiar_presupuesto", entrada), "aprobada");

    const r = (await adsCambiarPresupuesto.execute(ctx, entrada)) as {
      cambiado?: boolean;
      antes?: string;
      ahora?: string;
    };
    expect(r.cambiado).toBe(true);
    expect(r.antes).toContain("30.000");
    expect(r.ahora).toContain("60.000");
    expect(ads.escrituras()).toBe(1);
    expect(backups.guardados[0]?.snapshot).toEqual({ presupuestoDiario: 30_000 });
  });

  it("un rechazo se respeta y no se reintenta por otra vía", async () => {
    const { ctx, ads } = montar();
    const entrada = {
      plataforma: "google_ads" as const,
      cuenta_id: "acc_1",
      campana_id: "c_seca",
      diario: 5_000,
      motivo: "no trae resultados: lleva 140.000 pesos sin un cliente",
    };
    const aprobaciones = (ctx as unknown as { cuentas: { approvals: AprobacionesEnMemoria } }).cuentas.approvals;
    aprobaciones.decidir(huellaAccion("task_1", "ads_cambiar_presupuesto", entrada), "rechazada");

    const r = (await adsCambiarPresupuesto.execute(ctx, entrada)) as { aprobacion_rechazada?: boolean };
    expect(r.aprobacion_rechazada).toBe(true);
    expect(ads.escrituras()).toBe(0);
  });

  it("multiplicar el presupuesto por cuatro se rechaza antes de molestar a nadie", async () => {
    const { ctx, approvals } = montar();
    await expect(
      adsCambiarPresupuesto.execute(ctx, {
        plataforma: "google_ads",
        cuenta_id: "acc_1",
        campana_id: "c_buena",
        diario: 120_000,
        motivo: "quiero escalarla mucho porque funciona bien",
      }),
    ).rejects.toThrow(/triple/);
    expect(approvals.solicitudes).toHaveLength(0);
  });

  it("pausar también pasa por aprobación", async () => {
    const { ctx, ads, approvals } = montar();
    const r = (await adsPausarCampana.execute(ctx, {
      plataforma: "google_ads",
      cuenta_id: "acc_1",
      campana_id: "c_seca",
      motivo: "lleva 140.000 pesos y 95 clics sin un solo resultado",
    })) as { requiere_aprobacion?: boolean };
    expect(r.requiere_aprobacion).toBe(true);
    expect(ads.escrituras()).toBe(0);
    expect(approvals.solicitudes[0]?.resumen).toContain("Pausar");
  });

  it("con una conexión de solo lectura, lo dice en vez de fallar con un error técnico", async () => {
    const { ctx } = montar({ ads: new AdsEnMemoria({ puedeEscribir: false }) });
    await expect(
      adsPausarCampana.execute(ctx, {
        plataforma: "google_ads",
        cuenta_id: "acc_1",
        campana_id: "c_seca",
        motivo: "lleva 140.000 pesos y 95 clics sin un solo resultado",
      }),
    ).rejects.toThrow(/solo lectura/);
  });
});
