/**
 * Un encargo del Diseñador, de punta a punta por la misma cola.
 *
 * Se prueba con los dobles (`@strappy/disenador/testing`) porque dibujar de
 * verdad cuesta dinero del cliente y una prueba no puede gastarlo. Lo que se
 * verifica no es que compile, sino las tres promesas del agente: que la imagen
 * llega al cliente para que la VEA, que no se sube nada a su sitio sin un clic
 * humano, y que sin generador se lo explican en vez de reventar.
 */
import { describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import { BackupsEnMemoria, modeloGuionizado, type PasoGuion } from "@strappy/webmaster/testing";
import {
  AprobacionesEnMemoria,
  ESTILO_DE_EJEMPLO,
  ImagenesEnMemoria,
  MediosEnMemoria,
  PNG_MINIMO,
} from "@strappy/disenador/testing";
import { ColaEnMemoria } from "../src/queue/memoria.js";
import { ConsumidorDeTareas } from "../src/consumers/tareas.js";
import type { EstudioPort, SitePort, SitioConectado } from "../src/ports.js";

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

const IDEA = "un escritorio de abogado con documentos y una lámpara cálida, vista cenital";

function montar(guion: readonly PasoGuion[], o: { conGenerador?: boolean } = {}) {
  const cola = new ColaEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const imagenes = new ImagenesEnMemoria();
  const medios = new MediosEnMemoria();
  const avisos: { tipo: string; texto: string }[] = [];

  const estudio: EstudioPort = {
    async cargar() {
      return {
        conexionId: "conn_sitio",
        ...(o.conGenerador === false ? {} : { imagenes }),
        medios,
        estilo: ESTILO_DE_EJEMPLO,
        negocio: "Vox Legal",
        agentName: "Lucía",
      };
    },
  };

  const { modelo } = modeloGuionizado(guion);
  const consumidor = new ConsumidorDeTareas({
    puertos: {
      cola,
      sitios: new SitiosVacios(),
      backups: new BackupsEnMemoria(),
      aprobaciones,
      estudio,
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
    siteId: "site_1",
    agente: "disenador",
    titulo: "Hazme la portada del artículo de IA",
    detalle: "Para el artículo sobre inteligencia artificial y uso responsable.",
  });

  return { cola, aprobaciones, imagenes, medios, avisos, consumidor };
}

describe("encargo del Diseñador", () => {
  it("dibuja con los colores del sitio y deja la imagen a la vista del cliente", async () => {
    const m = montar([
      { llama: "img_ver_estilo", con: {} },
      { llama: "img_generar", con: { idea: IDEA, formato: "portada" } },
      { dice: "RESUMEN: te preparé la portada con los azules y el dorado de tu web." },
    ]);

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("portada");

    // Dibujó con la paleta medida del sitio, no con una inventada.
    expect(m.imagenes.llamadas[0]?.prompt).toContain("#D09E1D");
    expect(m.imagenes.llamadas[0]?.medida).toEqual({ ancho: 1200, alto: 630 });

    // Los pasos se cuentan con palabras del cliente.
    const pasos = (tarea.pasos ?? []) as { herramienta: string; etiqueta: string }[];
    expect(pasos.map((p) => p.etiqueta)).toEqual([
      "Mirando los colores de tu marca",
      "Dibujando la imagen",
    ]);

    // La imagen viaja dentro de la evidencia del encargo: es lo que hace que el
    // cliente la VEA en su pantalla en vez de tener que creerse que existe.
    const evidencia = tarea.evidencia as { capturas: { base64: string; mimeType: string }[] };
    expect(evidencia.capturas).toHaveLength(1);
    expect(evidencia.capturas[0]?.base64).toBe(PNG_MINIMO);
    expect(evidencia.capturas[0]?.mimeType).toBe("image/png");

    // Dibujar cuesta: una imagen son 100 créditos más los tokens.
    expect(tarea.creditos).toBeGreaterThanOrEqual(100);
    // Y no se subió nada al sitio, porque no se pidió.
    expect(m.medios.subidas).toHaveLength(0);
  });

  it("subirla al sitio espera el clic de una persona", async () => {
    const m = montar([
      { llama: "img_generar", con: { idea: IDEA, formato: "portada" } },
      {
        llama: "img_publicar",
        con: { borrador_id: "img_1", alt: "Escritorio de abogado con documentos" },
      },
      { dice: "RESUMEN: te dejé la portada lista para que la apruebes." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("esperando_aprobacion");
    // Lo importante: nada entró en el sitio del cliente.
    expect(m.medios.subidas).toHaveLength(0);
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
    // Y lo que lee antes de aprobar dice qué imagen es y dónde va.
    const resumen = m.aprobaciones.solicitudes[0]?.resumen ?? "";
    expect(resumen).toContain("Escritorio de abogado");
    expect(resumen).toContain("elnegocio.com");
    expect(m.avisos[0]?.tipo).toBe("aprobacion");
    // No consumió intento: no falló nada, falta un clic.
    expect(tarea.intentos).toBe(0);
  });

  it("sin generador de imágenes lo explica en vez de reventar", async () => {
    const m = montar(
      [
        { llama: "img_generar", con: { idea: IDEA, formato: "portada" } },
        { dice: "RESUMEN: hoy no puedo dibujar imágenes; te aviso cuando pueda." },
      ],
      { conGenerador: false },
    );

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("no puedo dibujar");
    expect(m.medios.subidas).toHaveLength(0);
  });
});
