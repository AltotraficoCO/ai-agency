/**
 * Un encargo de Marketing, de punta a punta por la misma cola que los del
 * Webmaster.
 *
 * Se prueba con los dobles de las plataformas (`@strappy/marketing/testing`)
 * porque los accesos de Google y de Meta tardan semanas en aprobarse, y no
 * tener credenciales no puede significar no poder probar. Lo que se verifica
 * aquí no es que compile, sino lo que le importa al cliente: que el encargo
 * salga con evidencia, que el dinero no se mueva sin un clic humano y que el
 * Webmaster siga entrando por su propio camino.
 */
import { describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import { BackupsEnMemoria, modeloGuionizado, type PasoGuion } from "@strappy/webmaster/testing";
// El doble de aprobaciones es el de Marketing porque guarda también el resumen:
// es justo lo que lee la persona antes de aprobar que se mueva su dinero.
import {
  AdsEnMemoria,
  AnalyticsEnMemoria,
  AprobacionesEnMemoria,
} from "@strappy/marketing/testing";
import { ColaEnMemoria } from "../src/queue/memoria.js";
import { ConsumidorDeTareas } from "../src/consumers/tareas.js";
import type { CuentasPort, SitePort, SitioConectado } from "../src/ports.js";

const TARIFAS: RateTable = {
  models: { "prueba/modelo": { input: 3, output: 15 } },
  fallback: { input: 10, output: 50 },
};

class SitiosVacios implements SitePort {
  async cargar(): Promise<SitioConectado | null> {
    return null;
  }
  async marcarTocado(): Promise<void> {}
}

function montar(guion: readonly PasoGuion[], o: { conPlataformas?: boolean } = {}) {
  const cola = new ColaEnMemoria();
  const backups = new BackupsEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const ads = new AdsEnMemoria();
  const avisos: { tipo: string; texto: string }[] = [];

  const cuentas: CuentasPort = {
    async cargar() {
      return {
        conexionId: o.conPlataformas === false ? null : "conn_ads",
        ads: o.conPlataformas === false ? [] : [ads],
        analytics: new AnalyticsEnMemoria(),
        negocio: "Vox Legal",
        agentName: "Paula",
      };
    },
  };

  const { modelo } = modeloGuionizado(guion);
  const consumidor = new ConsumidorDeTareas({
    puertos: {
      cola,
      sitios: new SitiosVacios(),
      backups,
      aprobaciones,
      cuentas,
      notificaciones: {
        async avisar({ tipo, texto }) {
          avisos.push({ tipo, texto });
        },
      },
    },
    workerId: "w1",
    model: modelo,
    modelId: "prueba/modelo",
    rates: TARIFAS,
    latidoMs: 5000,
  });

  // Un encargo de Marketing: sin sitio web, con el agente escrito en la fila.
  cola.encolar({
    id: "task_1",
    workspaceId: "ws_1",
    siteId: null,
    agente: "marketing",
    titulo: "¿Cómo van mis campañas esta semana?",
    detalle: "Dime en qué estoy tirando el dinero.",
  });

  return { cola, backups, aprobaciones, ads, avisos, consumidor };
}

describe("encargo de Marketing", () => {
  it("se ejecuta sin sitio web y deja su registro de trabajo", async () => {
    const m = montar([
      { llama: "ads_listar_cuentas" },
      { llama: "ads_revisar_campanas", con: { plataforma: "google_ads", cuenta_id: "acc_1", dias: 7 } },
      { dice: "RESUMEN: la campaña de display se llevó 280.000 pesos y trajo 2 clientes." },
    ]);

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("280.000");
    expect(tarea.creditos).toBeGreaterThan(0);

    // Los pasos se cuentan con las palabras del oficio, no con slugs.
    const pasos = (tarea.pasos ?? []) as { herramienta: string; etiqueta: string; estado: string }[];
    expect(pasos.map((p) => p.herramienta)).toEqual(["ads_listar_cuentas", "ads_revisar_campanas"]);
    expect(pasos[1]?.etiqueta).toBe("Mirando cómo van tus campañas");
    expect(pasos.every((p) => p.estado === "hecho")).toBe(true);

    // Solo miró: ni un cambio en las cuentas del cliente.
    expect(m.ads.escrituras()).toBe(0);
    expect(m.avisos[0]?.tipo).toBe("resultado");
  });

  it("cambiar un presupuesto queda esperando el clic de una persona", async () => {
    const m = montar([
      { llama: "ads_listar_cuentas" },
      {
        llama: "ads_cambiar_presupuesto",
        con: {
          plataforma: "google_ads",
          cuenta_id: "acc_1",
          campana_id: "c_buena",
          diario: 50_000,
          motivo: "Es la que trae clientes: 14 en la semana a 15.000 cada uno.",
        },
      },
      { dice: "RESUMEN: propuse subirle el presupuesto a la campaña que funciona." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("esperando_aprobacion");
    // El dinero del cliente no se movió.
    expect(m.ads.escrituras()).toBe(0);
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
    // Y lo que va a leer antes de aprobar dice el cambio en dinero.
    expect(m.aprobaciones.solicitudes[0]?.resumen).toContain("al mes");
    expect(m.avisos[0]?.tipo).toBe("aprobacion");
    // No consumió intento: no falló nada, falta un clic.
    expect(tarea.intentos).toBe(0);
  });

  it("sin plataformas conectadas lo explica en vez de reventar", async () => {
    const m = montar(
      [
        { llama: "ads_listar_cuentas" },
        { dice: "RESUMEN: no tienes ninguna plataforma de anuncios conectada todavía." },
      ],
      { conPlataformas: false },
    );

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("conectada");
  });
});

describe("enrutado por agente", () => {
  it("un encargo sin agente escrito sigue siendo del Webmaster", async () => {
    const cola = new ColaEnMemoria();
    cola.encolar({
      id: "task_viejo",
      workspaceId: "ws_1",
      siteId: "site_1",
      titulo: "Cambia el teléfono del pie",
      detalle: null,
    });
    const { modelo } = modeloGuionizado([{ dice: "RESUMEN: nada." }]);
    const consumidor = new ConsumidorDeTareas({
      puertos: {
        cola,
        // Sin sitio conectado: el camino del Webmaster falla por ahí, que es
        // justo la prueba de que fue por ese camino y no por el de Marketing.
        sitios: new SitiosVacios(),
        backups: new BackupsEnMemoria(),
        aprobaciones: new AprobacionesEnMemoria(),
      },
      workerId: "w1",
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
    });

    await consumidor.tick();
    const tarea = cola.buscar("task_viejo")!;
    expect(tarea.estado).toBe("failed");
    expect(tarea.error).toMatch(/no está conectado/);
  });
});
