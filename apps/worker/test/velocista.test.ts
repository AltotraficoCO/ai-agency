/**
 * Un encargo del Velocista, de punta a punta por la misma cola que los demás.
 *
 * Se prueba con los dobles (`@strappy/velocista/testing`) porque medir de
 * verdad tarda medio minuto y depende de una clave: no tenerla no puede
 * significar no poder probar. Lo que se verifica aquí no es que compile, sino
 * lo que le importa al cliente: que no se instala nada en su web sin un clic
 * humano, que sin con qué medir se le dice en vez de inventarse un tiempo, y
 * que el Webmaster sigue entrando por su propio camino.
 */
import { describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import { BackupsEnMemoria, modeloGuionizado, type PasoGuion } from "@strappy/webmaster/testing";
import {
  AprobacionesEnMemoria,
  MedidorEnMemoria,
  SitioEnMemoria,
  medicionLenta,
  medicionRapida,
} from "@strappy/velocista/testing";
import { ColaEnMemoria } from "../src/queue/memoria.js";
import { ConsumidorDeTareas } from "../src/consumers/tareas.js";
import type { SitePort, SitioConectado, VelocistaPort } from "../src/ports.js";

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

function montar(
  guion: readonly PasoGuion[],
  o: { conSitio?: boolean; conMedidor?: boolean; medidor?: MedidorEnMemoria } = {},
) {
  const cola = new ColaEnMemoria();
  const backups = new BackupsEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const sitio = new SitioEnMemoria();
  const medidor = o.medidor ?? new MedidorEnMemoria();
  const avisos: { tipo: string; texto: string }[] = [];

  const velocidad: VelocistaPort = {
    async cargar() {
      return {
        conexionId: o.conSitio === false ? null : "conn_web",
        ...(o.conSitio === false ? {} : { sitio }),
        ...(o.conMedidor === false ? {} : { rendimiento: medidor }),
        negocio: "Vox Legal",
        agentName: "Nico",
        secretos: ["clave-de-pagespeed-secreta"],
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
      velocidad,
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

  cola.encolar({
    id: "task_1",
    workspaceId: "ws_1",
    siteId: "conn_web",
    agente: "velocista",
    titulo: "Mi página tarda mucho en cargar en celular",
    detalle: "Arréglalo si se puede.",
  });

  return { cola, backups, aprobaciones, sitio, medidor, avisos, consumidor };
}

describe("encargo del Velocista", () => {
  it("mide, mira el sitio y deja su registro de trabajo sin tocar nada", async () => {
    const m = montar([
      { llama: "velocidad_medir", con: { ruta: "/", dispositivo: "movil" } },
      { llama: "velocidad_revisar_imagenes" },
      { llama: "velocidad_revisar_plugins" },
      {
        dice: "RESUMEN: tu página tarda 4,8 segundos en abrir en un celular. La portada pesa 3 MB y no tienes caché.",
      },
    ]);

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("4,8 segundos");
    expect(tarea.creditos).toBeGreaterThan(0);

    // Los pasos se cuentan con las palabras del oficio, no con slugs.
    const pasos = (tarea.pasos ?? []) as { herramienta: string; etiqueta: string; estado: string }[];
    expect(pasos[0]?.etiqueta).toBe("Midiendo la velocidad de tu página");
    expect(pasos.every((p) => p.estado === "hecho")).toBe(true);

    // Solo miró: ni un cambio en la web del cliente.
    expect(m.sitio.escrituras()).toBe(0);
    expect(m.avisos[0]?.tipo).toBe("resultado");
  });

  it("instalar la caché queda esperando el clic de una persona", async () => {
    const m = montar([
      { llama: "velocidad_medir", con: { ruta: "/", dispositivo: "movil" } },
      { llama: "velocidad_revisar_plugins" },
      {
        llama: "velocidad_activar_cache",
        con: {
          plugin: "litespeed-cache",
          motivo: "Tu página tarda 4,8 segundos en celular y no tiene caché.",
        },
      },
      { dice: "RESUMEN: propuse activar la caché." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("esperando_aprobacion");
    // La web del cliente no se tocó.
    expect(m.sitio.escrituras()).toBe(0);
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
    // Y lo que va a leer antes de aprobar dice qué gana y cómo se vuelve atrás.
    expect(m.aprobaciones.solicitudes[0]?.resumen).toContain("LiteSpeed Cache");
    expect(m.aprobaciones.solicitudes[0]?.resumen).toContain("vuelve a como estaba");
    expect(m.avisos[0]?.tipo).toBe("aprobacion");
    expect(tarea.intentos).toBe(0);
  });

  it("puede enseñar el antes y el después con dos mediciones reales", async () => {
    const medidor = new MedidorEnMemoria({ enOrden: [medicionLenta(), medicionRapida()] });
    const m = montar(
      [
        { llama: "velocidad_medir", con: { ruta: "/", dispositivo: "movil" } },
        { llama: "velocidad_comparar", con: { ruta: "/", dispositivo: "movil" } },
        { dice: "RESUMEN: pasó de 4,8 a 2,1 segundos." },
      ],
      { medidor },
    );

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("2,1 segundos");
    expect(medidor.llamadas).toHaveLength(2);
  });

  it("sin con qué medir lo explica en vez de reventar", async () => {
    const m = montar(
      [
        { llama: "velocidad_medir", con: { ruta: "/", dispositivo: "movil" } },
        { dice: "RESUMEN: no pude medir tu página ahora mismo." },
      ],
      { conMedidor: false },
    );

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("no pude medir");
  });

  it("la clave de medición nunca sale en lo que lee el cliente", async () => {
    const m = montar([
      { dice: "RESUMEN: medí con la clave clave-de-pagespeed-secreta y todo bien." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.resumen).not.toContain("clave-de-pagespeed-secreta");
    expect(tarea.resumen).toContain("***");
  });
});
