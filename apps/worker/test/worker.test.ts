/**
 * Pruebas del worker: reclamar, ejecutar y cerrar una tarea.
 *
 * El consumidor se prueba entero contra el doble de la REST API de WordPress y
 * un modelo guionizado, porque lo que hay que verificar no es que compile sino
 * que un encargo entre por la cola y salga con evidencia, backups y un estado
 * que un humano pueda entender.
 */
import { describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_DOBLE,
  crearDobleWordPress,
  modeloGuionizado,
  NavegadorFalso,
  type DobleWordPress,
  type PasoGuion,
} from "@strappy/webmaster/testing";
import { ColaEnMemoria } from "../src/queue/memoria.js";
import { ColaPostgres } from "../src/queue/postgres.js";
import { ConsumidorDeTareas } from "../src/consumers/tareas.js";
import { Runner } from "../src/runner.js";
import type { SitePort, SitioConectado, SqlPool } from "../src/ports.js";

const TARIFAS: RateTable = {
  models: { "prueba/modelo": { input: 3, output: 15 } },
  fallback: { input: 10, output: 50 },
};

// ---------------------------------------------------------------------------

class SitiosEnMemoria implements SitePort {
  tocado = false;
  constructor(private readonly sitio: SitioConectado | null) {}
  async cargar(): Promise<SitioConectado | null> {
    if (!this.sitio) return null;
    return { ...this.sitio, primerContacto: this.sitio.primerContacto && !this.tocado };
  }
  async marcarTocado(): Promise<void> {
    this.tocado = true;
  }
}

function montar(guion: readonly PasoGuion[], o: { primerContacto?: boolean } = {}) {
  const wp: DobleWordPress = crearDobleWordPress();
  const cola = new ColaEnMemoria();
  const backups = new BackupsEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const avisos: { tipo: string; texto: string }[] = [];

  const sitios = new SitiosEnMemoria({
    id: "site_1",
    workspaceId: "ws_1",
    tipo: "wp",
    url: BASE_DOBLE,
    credenciales: {
      url: BASE_DOBLE,
      user: wp.estado.usuario,
      appPassword: wp.estado.appPassword,
    },
    agentName: "Max",
    primerContacto: o.primerContacto ?? false,
  });

  const navegador = new NavegadorFalso(BASE_DOBLE, () => ({
    titulo: "ok",
    texto: "ok",
    status: 200,
  }));

  const { modelo } = modeloGuionizado(guion);
  const consumidor = new ConsumidorDeTareas({
    puertos: {
      cola,
      sitios,
      backups,
      aprobaciones,
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
    navegadorPara: async () => navegador,
    fetchSitio: wp.fetch,
  });

  cola.encolar({
    id: "task_1",
    workspaceId: "ws_1",
    siteId: "site_1",
    titulo: "Cambia el título de la página de historia",
    detalle: "Que diga «Nuestra historia desde 1998».",
  });

  return { wp, cola, backups, aprobaciones, sitios, avisos, consumidor, navegador };
}

// ---------------------------------------------------------------------------

describe("consumidor de tareas", () => {
  it("reclama, ejecuta, escribe evidencia y avisa al cliente", async () => {
    const m = montar([
      { llama: "wp_listar_contenido" },
      { llama: "wp_leer_contenido", con: { tipo: "page", id: 7 } },
      {
        llama: "wp_editar_contenido",
        con: { tipo: "page", id: 7, nuevo_titulo: "Nuestra historia desde 1998" },
      },
      { llama: "navegador_ver_pagina", con: { path: "/nuestra-historia" } },
      { dice: "RESUMEN: cambié el título y lo comprobé en el navegador." },
    ]);

    expect(await m.consumidor.tick()).toBe(true);

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect(tarea.resumen).toBe("cambié el título y lo comprobé en el navegador.");
    expect(tarea.creditos).toBeGreaterThan(0);
    // El registro de trabajo queda guardado, un paso por herramienta y todos cerrados.
    const pasos = (tarea.pasos ?? []) as { herramienta: string; estado: string }[];
    expect(pasos.map((p) => p.herramienta)).toEqual([
      "wp_listar_contenido",
      "wp_leer_contenido",
      "wp_editar_contenido",
      "navegador_ver_pagina",
    ]);
    expect(pasos.every((p) => p.estado === "hecho")).toBe(true);

    const evidencia = tarea.evidencia as {
      acciones: unknown[];
      capturas: unknown[];
      backups: string[];
    };
    expect(evidencia.acciones).toHaveLength(4);
    expect(evidencia.capturas).toHaveLength(1);
    expect(evidencia.backups).toEqual(["bk_1"]);

    expect(m.wp.estado.contenido.find((c) => c.id === 7)?.titulo).toBe(
      "Nuestra historia desde 1998",
    );
    expect(m.avisos).toEqual([
      { tipo: "resultado", texto: "cambié el título y lo comprobé en el navegador." },
    ]);
    // El sitio deja de ser "primer contacto" solo tras una ejecución real.
    expect(m.sitios.tocado).toBe(true);
    // Y el navegador se cierra: no se dejan procesos colgando entre tareas.
    expect(m.navegador.cerrado).toBe(true);
  });

  it("una tarea con acción sensible queda suspendida y guarda la conversación", async () => {
    const m = montar([
      {
        llama: "wp_editar_contenido",
        con: { tipo: "page", id: 11, nuevo_contenido_html: "<p>35 €</p>" },
      },
      { dice: "RESUMEN: falta tu visto bueno para el cambio de precios." },
    ]);

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("esperando_aprobacion");
    expect(tarea.mensajes?.length).toBeGreaterThan(0);
    // No consumió intento: no falló nada, falta un clic.
    expect(tarea.intentos).toBe(0);
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
    expect(m.avisos[0]?.tipo).toBe("aprobacion");
    expect(m.wp.estado.contenido.find((c) => c.id === 11)?.contenido).toBe(
      "<p>Suscripción semanal: 20 €</p>",
    );
  });

  it("el primer contacto se ejecuta en simulación y el sitio no queda tocado", async () => {
    const m = montar(
      [
        { llama: "wp_listar_contenido" },
        {
          llama: "wp_editar_contenido",
          con: { tipo: "page", id: 7, nuevo_titulo: "Otro título" },
        },
        { dice: "RESUMEN: este es el plan." },
      ],
      { primerContacto: true },
    );

    await m.consumidor.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("done");
    expect((tarea.evidencia as { simulacion: boolean }).simulacion).toBe(true);
    expect(m.wp.estado.contenido.find((c) => c.id === 7)?.titulo).toBe("Nuestra historia");
    expect(m.sitios.tocado).toBe(false);
  });

  it("un fallo de configuración no se reintenta", async () => {
    const cola = new ColaEnMemoria();
    cola.encolar({
      id: "task_1",
      workspaceId: "ws_1",
      siteId: "site_1",
      titulo: "Algo",
      detalle: null,
    });
    const { modelo } = modeloGuionizado([{ dice: "RESUMEN: nada." }]);
    const consumidor = new ConsumidorDeTareas({
      puertos: {
        cola,
        sitios: new SitiosEnMemoria(null),
        backups: new BackupsEnMemoria(),
        aprobaciones: new AprobacionesEnMemoria(),
      },
      workerId: "w1",
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
    });

    await consumidor.tick();
    const tarea = cola.buscar("task_1")!;
    expect(tarea.estado).toBe("failed");
    expect(tarea.error).toMatch(/no está conectado/);
  });

  it("sin tareas no hace nada y lo dice", async () => {
    const m = montar([{ dice: "RESUMEN: nada." }]);
    await m.consumidor.tick();
    expect(await m.consumidor.tick()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("cola", () => {
  it("dos workers no se llevan la misma tarea", async () => {
    const cola = new ColaEnMemoria();
    cola.encolar({ id: "t1", workspaceId: "w", siteId: "s", titulo: "a", detalle: null });
    cola.encolar({ id: "t2", workspaceId: "w", siteId: "s", titulo: "b", detalle: null });

    const a = await cola.reclamar({ workerId: "w1", arrendamientoMs: 60_000 });
    const b = await cola.reclamar({ workerId: "w2", arrendamientoMs: 60_000 });
    expect(a?.id).toBe("t1");
    expect(b?.id).toBe("t2");
    expect(await cola.reclamar({ workerId: "w3", arrendamientoMs: 60_000 })).toBeNull();
  });

  it("una tarea cuyo arrendamiento expiró la recoge otro worker", async () => {
    let ahora = 1_000;
    const cola = new ColaEnMemoria({ now: () => ahora });
    cola.encolar({ id: "t1", workspaceId: "w", siteId: "s", titulo: "a", detalle: null });

    expect((await cola.reclamar({ workerId: "w1", arrendamientoMs: 100 }))?.id).toBe("t1");
    expect(await cola.reclamar({ workerId: "w2", arrendamientoMs: 100 })).toBeNull();
    ahora += 500; // el worker que la tenía murió
    const rescatada = await cola.reclamar({ workerId: "w2", arrendamientoMs: 100 });
    expect(rescatada?.id).toBe("t1");
    expect(rescatada?.intentos).toBe(2);
  });

  it("un fallo determinista deja de reintentarse", async () => {
    const cola = new ColaEnMemoria({ maxIntentos: 2 });
    cola.encolar({ id: "t1", workspaceId: "w", siteId: "s", titulo: "a", detalle: null });
    for (let i = 0; i < 2; i += 1) {
      const t = await cola.reclamar({ workerId: "w1", arrendamientoMs: 1000 });
      expect(t).not.toBeNull();
      await cola.fallar({
        taskId: "t1",
        workerId: "w1",
        error: "boom",
        motivo: "error",
        evidencia: null,
        reintentable: true,
      });
    }
    expect(await cola.reclamar({ workerId: "w1", arrendamientoMs: 1000 })).toBeNull();
    expect(cola.buscar("t1")?.estado).toBe("failed");
  });
});

// ---------------------------------------------------------------------------

describe("cola en Postgres", () => {
  /** Pool de mentira que solo apunta el SQL que se le pide. */
  function poolEspia(filas: Record<string, unknown>[] = []) {
    const consultas: { sql: string; valores: readonly unknown[] }[] = [];
    const ejecutar = async (sql: string, valores: readonly unknown[] = []) => {
      consultas.push({ sql, valores });
      return { rows: sql.includes("update") && filas.length ? filas : [] };
    };
    const pool = {
      query: ejecutar,
      connect: async () => ({ query: ejecutar, release: () => {} }),
    } as unknown as SqlPool;
    return { pool, consultas };
  }

  it("reclama con FOR UPDATE SKIP LOCKED dentro de una transacción", async () => {
    const { pool, consultas } = poolEspia([
      {
        id: "t1",
        workspace_id: "ws",
        site_id: "s",
        agent_id: null,
        titulo: "a",
        detalle: null,
        intentos: 1,
        mensajes: null,
        aprobaciones: null,
      },
    ]);
    const cola = new ColaPostgres(pool);
    const tarea = await cola.reclamar({ workerId: "w1", arrendamientoMs: 60_000 });

    expect(tarea?.id).toBe("t1");
    const sqls = consultas.map((c) => c.sql);
    expect(sqls[0]).toBe("begin");
    expect(sqls[1]).toContain("for update skip locked");
    expect(sqls[1]).toContain("lease_until");
    expect(sqls.at(-1)).toBe("commit");
  });

  it("no acepta un nombre de tabla inyectable", () => {
    const { pool } = poolEspia();
    expect(() => new ColaPostgres(pool, { tabla: "tareas; drop table users" })).toThrow(
      /Nombre de tabla inválido/,
    );
  });
});

// ---------------------------------------------------------------------------

describe("runner", () => {
  it("se apaga sin dejar trabajo a medias", async () => {
    let enCurso = 0;
    let terminados = 0;
    const runner = new Runner({
      consumidores: [
        {
          nombre: "lento",
          async tick() {
            enCurso += 1;
            await new Promise((r) => setTimeout(r, 30));
            enCurso -= 1;
            terminados += 1;
            return true;
          },
        },
      ],
    });

    const vuelta = runner.vuelta();
    await new Promise((r) => setTimeout(r, 5));
    const parada = runner.parar();
    await Promise.all([vuelta, parada]);
    expect(enCurso).toBe(0);
    expect(terminados).toBe(1);
  });
});
