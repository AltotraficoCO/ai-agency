/**
 * Un encargo del agente financiero, de punta a punta por la misma cola.
 *
 * Se prueba con los dobles del sistema contable (`@strappy/administrativo/testing`)
 * porque las credenciales de Alegra son del cliente y no tenerlas no puede
 * significar no poder probar. Lo que se verifica no es que compile, sino lo que
 * le importa al dueño del negocio: que el encargo salga con su registro, que NO
 * se emita ni un papel sin un clic humano, y que sin contabilidad conectada se
 * lo expliquen en vez de reventar.
 */
import { describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import { BackupsEnMemoria, modeloGuionizado, type PasoGuion } from "@strappy/webmaster/testing";
import {
  AprobacionesEnMemoria,
  ContabilidadEnMemoria,
} from "@strappy/administrativo/testing";
import { ColaEnMemoria } from "../src/queue/memoria.js";
import { ConsumidorDeTareas } from "../src/consumers/tareas.js";
import type { LibrosPort, SitePort, SitioConectado } from "../src/ports.js";

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

function montar(guion: readonly PasoGuion[], o: { conContabilidad?: boolean; slug?: string } = {}) {
  const cola = new ColaEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const contabilidad = new ContabilidadEnMemoria();
  const avisos: { tipo: string; texto: string }[] = [];

  const libros: LibrosPort = {
    async cargar() {
      return o.conContabilidad === false
        ? { conexionId: null, negocio: "Vox Legal", agentName: "Sara" }
        : {
            conexionId: "conn_alegra",
            contabilidad,
            negocio: "Vox Legal",
            agentName: "Sara",
            // El token nunca puede salir en un paso ni en un resumen.
            secretos: ["tok_secretisimo_123456"],
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
      libros,
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

  // Un encargo financiero: sin sitio web, con el agente escrito en la fila.
  cola.encolar({
    id: "task_1",
    workspaceId: "ws_1",
    siteId: null,
    agente: o.slug ?? "administrativo",
    titulo: "¿Cuánto nos deben?",
    detalle: "Dime qué está vencido y qué es lo más urgente.",
  });

  return { cola, aprobaciones, contabilidad, avisos, consumidor };
}

describe("encargo del agente financiero", () => {
  it("mira las cuentas y deja su registro de trabajo", async () => {
    const m = montar([
      { llama: "admin_estado_de_caja", con: { dias: 30 } },
      { llama: "admin_facturas_por_cobrar", con: { cuantas: 3, solo_vencidas: true } },
      { dice: "RESUMEN: te deben 42 millones y lo más viejo lleva cuatro meses sin pagarse." },
    ]);

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("42 millones");
    expect(tarea.creditos).toBeGreaterThan(0);

    // Los pasos se cuentan con las palabras del oficio, no con slugs.
    const pasos = (tarea.pasos ?? []) as { herramienta: string; etiqueta: string; estado: string }[];
    expect(pasos.map((p) => p.herramienta)).toEqual([
      "admin_estado_de_caja",
      "admin_facturas_por_cobrar",
    ]);
    expect(pasos[0]?.etiqueta).toBe("Revisando cuánto te deben y cuánto entró");
    expect(pasos.every((p) => p.estado === "hecho")).toBe(true);

    // Solo miró: ni un papel en la contabilidad del cliente.
    expect(m.contabilidad.escrituras()).toBe(0);
    expect(m.avisos[0]?.tipo).toBe("resultado");
  });

  it("emitir una factura queda esperando el clic de una persona", async () => {
    const m = montar([
      { llama: "admin_buscar_cliente", con: { texto: "Distribuciones" } },
      {
        llama: "admin_emitir_factura",
        con: {
          cliente_id: "cli_1",
          moneda: "COP",
          lineas: [
            { descripcion: "Asesoría legal de septiembre", cantidad: 1, precio: 1_000_000, impuesto_porcentaje: 19 },
          ],
        },
      },
      { dice: "RESUMEN: te dejé lista la factura para que la apruebes." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("esperando_aprobacion");
    // Lo importante: no se emitió nada.
    expect(m.contabilidad.escrituras()).toBe(0);
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
    // Y lo que va a leer antes de aprobar dice el dinero y a quién.
    const resumen = m.aprobaciones.solicitudes[0]?.resumen ?? "";
    expect(resumen).toContain("Distribuciones Pérez");
    expect(resumen).toMatch(/1\.190\.000|1190000/);
    expect(m.avisos[0]?.tipo).toBe("aprobacion");
    // No consumió intento: no falló nada, falta un clic.
    expect(tarea.intentos).toBe(0);
  });

  it("sin contabilidad conectada lo explica en vez de reventar", async () => {
    const m = montar(
      [
        { llama: "admin_estado_de_caja", con: { dias: 30 } },
        { dice: "RESUMEN: todavía no tienes tu sistema de facturación conectado." },
      ],
      { conContabilidad: false },
    );

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("conectado");
    // El paso falló, pero el encargo terminó contándolo.
    const pasos = (tarea.pasos ?? []) as { estado: string; detalle: string | null }[];
    expect(pasos[0]?.estado).toBe("error");
  });

  it("el token del sistema contable nunca sale en lo que lee el cliente", async () => {
    const m = montar([
      { dice: "RESUMEN: entré con el token tok_secretisimo_123456 y todo bien." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.resumen).not.toContain("tok_secretisimo_123456");
    expect(tarea.resumen).toContain("***");
  });
});

// ---------------------------------------------------------------------------

describe("a quién se manda el encargo", () => {
  it("un slug con espacios o mayúsculas nombra al mismo oficio", async () => {
    // Lo escribe un modelo, no un formulario: cuando un agente le pide ayuda a
    // un compañero teclea su nombre, y «Reportes » con un espacio nombraba un
    // oficio que existe y se llevaba un rechazo.
    const m = montar([{ dice: "RESUMEN: te deben 42 millones." }], { slug: "  Reportes  " });

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toContain("42 millones");
  });

  it("un oficio que este worker no sabe ejecutar se rechaza, no cae en otro", async () => {
    // El respaldo anterior mandaba cualquier slug desconocido al Administrativo,
    // que SÍ puede emitir facturas. Un nombre mal escrito acababa con el oficio
    // equivocado tocando la contabilidad del cliente en vez de fallar.
    const m = montar([{ dice: "RESUMEN: no debería llegar aquí." }], { slug: "contable" });

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).not.toBe("done");
    expect(m.contabilidad.escrituras()).toBe(0);
  });
});
