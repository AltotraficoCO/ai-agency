import { describe, expect, it } from "vitest";
import { crearClienteWhatsApp } from "../src/client.js";
import {
  AVISO_COBRO_META,
  DIAS_RECONSOLIDACION,
  inicioDeReconsolidacion,
  leerGastoEnMeta,
  rangoASincronizar,
  resumirGasto,
} from "../src/analytics.js";
import { fixture } from "./fixtures.js";
import type { ConversationAnalyticsRaw } from "../src/types.js";

const AHORA = new Date(1756339200 * 1000); // fin del último punto de la grabación

function api(alPedir?: (url: string) => void) {
  return crearClienteWhatsApp({
    accessToken: "token_del_cliente",
    dormir: async () => {},
    fetch: async (url) => {
      alPedir?.(url);
      return new Response(JSON.stringify(fixture("analitica-conversaciones")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

describe("gasto del cliente en Meta", () => {
  it("suma conversaciones y coste, y agrupa por categoría", () => {
    const resumen = resumirGasto(fixture<ConversationAnalyticsRaw>("analitica-conversaciones"), {
      desde: new Date(1755993600 * 1000),
      hasta: AHORA,
      ahora: AHORA,
    });
    expect(resumen.conversaciones).toBe(285);
    expect(resumen.costeTotal).toBeCloseTo(10.72, 2);
    expect(resumen.porCategoria.map((c) => c.categoria)).toContain("SERVICE");
    expect(resumen.porCategoria[0]?.coste).toBeGreaterThanOrEqual(
      resumen.porCategoria[1]?.coste ?? 0,
    );
  });

  it("marca como provisionales los últimos 3 días: Meta consolida con retraso", () => {
    const resumen = resumirGasto(fixture<ConversationAnalyticsRaw>("analitica-conversaciones"), {
      desde: new Date(1755993600 * 1000),
      hasta: AHORA,
      ahora: AHORA,
    });
    const provisionales = resumen.puntos.filter((p) => p.provisional);
    expect(provisionales.length).toBeGreaterThan(0);
    expect(provisionales.length).toBeLessThan(resumen.puntos.length);
    expect(resumen.costeProvisional).toBeGreaterThan(0);
    expect(resumen.costeProvisional).toBeLessThan(resumen.costeTotal);
    expect(resumen.aviso).toContain(`${DIAS_RECONSOLIDACION} días`);
  });

  it("el aviso deja claro que el cobro lo hace Meta, no nosotros", () => {
    const vacio = resumirGasto({}, { desde: AHORA, hasta: AHORA, ahora: AHORA });
    expect(vacio.aviso).toBe(AVISO_COBRO_META);
    expect(vacio.aviso).toContain("Meta");
    expect(vacio.costeTotal).toBe(0);
  });

  it("los puntos salen ordenados por fecha", () => {
    const resumen = resumirGasto(fixture<ConversationAnalyticsRaw>("analitica-conversaciones"), {
      desde: new Date(0),
      hasta: AHORA,
      ahora: AHORA,
    });
    const tiempos = resumen.puntos.map((p) => p.desde.getTime());
    expect([...tiempos].sort((a, b) => a - b)).toEqual(tiempos);
  });

  it("pide la analítica con el token del propio cliente", async () => {
    const urls: string[] = [];
    const resumen = await leerGastoEnMeta(api((u) => urls.push(u)), {
      wabaId: "102290129340398",
      dias: 30,
      now: () => AHORA,
    });
    expect(urls[0]).toContain("/102290129340398");
    expect(decodeURIComponent(urls[0] ?? "")).toContain("conversation_analytics");
    expect(resumen.conversaciones).toBe(285);
  });
});

describe("ventana de reconsolidación", () => {
  it("el corte está 3 días atrás", () => {
    const corte = inicioDeReconsolidacion(AHORA);
    expect(AHORA.getTime() - corte.getTime()).toBe(DIAS_RECONSOLIDACION * 24 * 60 * 60 * 1000);
  });

  it("al resincronizar se releen siempre los últimos 3 días, aunque ya se guardaran", () => {
    const ultima = new Date(AHORA.getTime() - 60 * 60 * 1000); // hace una hora
    const { desde } = rangoASincronizar({ ultimaSincronizacion: ultima, ahora: AHORA });
    expect(desde.getTime()).toBe(inicioDeReconsolidacion(AHORA).getTime());
  });

  it("la primera sincronización trae la ventana completa", () => {
    const { desde, hasta } = rangoASincronizar({ ultimaSincronizacion: null, ahora: AHORA, diasMaximos: 30 });
    expect(hasta).toEqual(AHORA);
    expect(AHORA.getTime() - desde.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("nunca se pide más allá del máximo de días", () => {
    const muyVieja = new Date(AHORA.getTime() - 365 * 24 * 60 * 60 * 1000);
    const { desde } = rangoASincronizar({ ultimaSincronizacion: muyVieja, ahora: AHORA, diasMaximos: 30 });
    expect(AHORA.getTime() - desde.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
