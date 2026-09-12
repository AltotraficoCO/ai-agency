/**
 * El trabajo programado, de punta a punta.
 *
 * Lo que se prueba no es que compile: son las promesas que le hacemos al
 * cliente cuando le decimos «cada mañana lo revisa solo». Que llegue a su hora,
 * que un worker apagado el fin de semana no le dispare tres informes al volver,
 * que no se le cobre en silencio cuando se queda sin saldo, que despedir al
 * agente lo calle, y —la más importante— que trabajar solo NO signifique
 * aprobarse solo los gastos.
 */
import { describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import { proximaEjecucion, type Cadencia } from "@strappy/core";
import { BackupsEnMemoria, modeloGuionizado, type PasoGuion } from "@strappy/webmaster/testing";
import { AprobacionesEnMemoria, ContabilidadEnMemoria } from "@strappy/administrativo/testing";
import { ColaEnMemoria } from "../src/queue/memoria.js";
import { ConsumidorDeProgramados } from "../src/consumers/programados.js";
import { ConsumidorDeTareas } from "../src/consumers/tareas.js";
import type {
  LibrosPort,
  ProgramadoReclamado,
  ProgramadorPort,
  SitePort,
  SitioConectado,
} from "../src/ports.js";

const TARIFAS: RateTable = {
  models: { "prueba/modelo": { input: 3, output: 15 } },
  fallback: { input: 10, output: 50 },
};

const BOGOTA = "America/Bogota";

/** Cada mañana a las 8, hora de Colombia. */
const CADA_MANANA: Cadencia = { frecuencia: "diaria", hora: 8, minuto: 0, zona: BOGOTA };

/** 12-sep-2026, 08:00 en Bogotá: la hora exacta a la que toca. */
const A_SU_HORA = new Date("2026-09-12T13:00:00Z");

class SitiosVacios implements SitePort {
  async cargar(): Promise<SitioConectado | null> {
    return null;
  }
  async marcarTocado(): Promise<void> {}
}

/**
 * El programador en memoria. `lanzar` encola de verdad en la cola de tareas:
 * así el test comprueba lo que de verdad importa, que el encargo creado se
 * ejecuta como cualquier otro, aprobaciones incluidas.
 */
class ProgramadorEnMemoria implements ProgramadorPort {
  pendiente: ProgramadoReclamado | null;
  reclamadoPor: string[] = [];
  reprogramados: { id: string; proxima: Date }[] = [];
  pausados: { id: string; motivo: string }[] = [];
  lanzados: ProgramadoReclamado[] = [];
  apagadosPorBaja = 0;
  saldoActual = 50_000;

  constructor(
    private readonly cola: ColaEnMemoria,
    programado: ProgramadoReclamado,
  ) {
    this.pendiente = programado;
  }

  async reclamar(input: { workerId: string }): Promise<ProgramadoReclamado | null> {
    // Un solo worker se lo lleva: el segundo que llega no encuentra nada, que
    // es lo que hace `FOR UPDATE SKIP LOCKED` en Postgres.
    const p = this.pendiente;
    if (!p) return null;
    this.pendiente = null;
    this.reclamadoPor.push(input.workerId);
    return p;
  }

  async lanzar(input: { id: string; programado: ProgramadoReclamado; proxima: Date }): Promise<string | null> {
    const taskId = `task_${this.lanzados.length + 1}`;
    this.lanzados.push(input.programado);
    this.reprogramados.push({ id: input.id, proxima: input.proxima });
    this.cola.encolar({
      id: taskId,
      workspaceId: input.programado.workspaceId,
      siteId: null,
      agente: input.programado.agente,
      titulo: input.programado.titulo,
      detalle: input.programado.detalle,
    });
    return taskId;
  }

  async reprogramar(input: { id: string; proxima: Date }): Promise<void> {
    this.reprogramados.push({ id: input.id, proxima: input.proxima });
  }

  async pausar(input: { id: string; motivo: string }): Promise<void> {
    this.pausados.push({ id: input.id, motivo: input.motivo });
  }

  async saldo(): Promise<number> {
    return this.saldoActual;
  }

  async sincronizar(): Promise<number> {
    return this.apagadosPorBaja;
  }
}

function programado(o: Partial<ProgramadoReclamado> = {}): ProgramadoReclamado {
  return {
    id: "prog_1",
    workspaceId: "ws_1",
    agentId: "agente_1",
    agente: "administrativo",
    titulo: "Repaso de la mañana",
    detalle: "Revisa qué facturas vencen esta semana y dime lo más urgente.",
    cadencia: CADA_MANANA,
    previstaEn: A_SU_HORA,
    ...o,
  };
}

function montar(o: { ahora?: Date; prog?: Partial<ProgramadoReclamado> } = {}) {
  const cola = new ColaEnMemoria();
  const programador = new ProgramadorEnMemoria(cola, programado(o.prog ?? {}));
  const consumidor = new ConsumidorDeProgramados({
    programador,
    workerId: "w1",
    ahora: () => o.ahora ?? A_SU_HORA,
  });
  return { cola, programador, consumidor };
}

describe("cuando llega la hora", () => {
  it("crea el encargo y programa el siguiente para mañana", async () => {
    const m = montar();

    expect(await m.consumidor.tick()).toBe(true);

    // El encargo existe y lo ejecutará el agente que corresponde.
    expect(m.cola.tareas).toHaveLength(1);
    expect(m.cola.tareas[0]?.agente).toBe("administrativo");
    expect(m.cola.tareas[0]?.titulo).toBe("Repaso de la mañana");
    expect(m.cola.tareas[0]?.estado).toBe("queued");

    // Y la próxima es mañana a las 8 de Bogotá, no dentro de 24 horas exactas.
    const proxima = m.programador.reprogramados[0]?.proxima;
    expect(proxima?.toISOString()).toBe("2026-09-13T13:00:00.000Z");
  });

  it("dos workers no disparan el mismo trabajo dos veces", async () => {
    const m = montar();
    const segundo = new ConsumidorDeProgramados({
      programador: m.programador,
      workerId: "w2",
      ahora: () => A_SU_HORA,
    });

    expect(await m.consumidor.tick()).toBe(true);
    // El segundo llega y ya no queda nada que reclamar.
    expect(await segundo.tick()).toBe(false);
    expect(m.cola.tareas).toHaveLength(1);
  });
});

describe("cuando el worker estuvo caído", () => {
  it("se salta lo atrasado en vez de entregarlo fuera de tiempo", async () => {
    // Trece horas tarde: el repaso de la mañana ya no sirve.
    const m = montar({ ahora: new Date("2026-09-13T02:00:00Z") });

    expect(await m.consumidor.tick()).toBe(true);

    expect(m.cola.tareas).toHaveLength(0);
    expect(m.programador.reprogramados).toHaveLength(1);
  });

  it("no acumula: tres días apagado es UN encargo, no tres", async () => {
    const m = montar({
      ahora: new Date("2026-09-13T12:30:00Z"),
      prog: { previstaEn: new Date("2026-09-10T13:00:00Z") },
    });

    await m.consumidor.tick();

    expect(m.cola.tareas.length).toBeLessThanOrEqual(1);
    const proxima = m.programador.reprogramados[0]?.proxima;
    expect(proxima?.getTime()).toBeGreaterThan(new Date("2026-09-13T12:30:00Z").getTime());
    expect(proxima?.toISOString()).toBe(
      proximaEjecucion(new Date("2026-09-13T12:30:00Z"), CADA_MANANA).toISOString(),
    );
  });
});

describe("cuando no hay con qué pagarlo", () => {
  it("se pausa y dice por qué, en vez de fallar cada mañana", async () => {
    const m = montar();
    m.programador.saldoActual = 0;

    expect(await m.consumidor.tick()).toBe(true);

    expect(m.cola.tareas).toHaveLength(0);
    expect(m.programador.pausados).toEqual([{ id: "prog_1", motivo: "sin_creditos" }]);
  });
});

describe("cuando el cliente despide al agente", () => {
  it("sus trabajos programados se apagan en la siguiente revisión", async () => {
    const m = montar();
    m.programador.apagadosPorBaja = 2;
    const avisos: string[] = [];
    const consumidor = new ConsumidorDeProgramados({
      programador: m.programador,
      workerId: "w1",
      ahora: () => A_SU_HORA,
      log: (x) => avisos.push(x),
    });

    await consumidor.tick();

    expect(avisos.some((a) => a.includes("ya no está contratado"))).toBe(true);
  });
});

describe("trabajar solo no es aprobarse solo el gasto", () => {
  it("un encargo programado que toca dinero queda esperando el clic", async () => {
    const m = montar();
    const aprobaciones = new AprobacionesEnMemoria();
    const contabilidad = new ContabilidadEnMemoria();
    const libros: LibrosPort = {
      async cargar() {
        return {
          conexionId: "conn_alegra",
          contabilidad,
          negocio: "Vox Legal",
          agentName: "Sara",
        };
      },
    };

    // El agente, al hacer su repaso, decide emitir una factura.
    const guion: PasoGuion[] = [
      { llama: "admin_buscar_cliente", con: { texto: "Distribuciones" } },
      {
        llama: "admin_emitir_factura",
        con: {
          cliente_id: "cli_1",
          moneda: "COP",
          lineas: [
            {
              descripcion: "Asesoría legal de septiembre",
              cantidad: 1,
              precio: 1_000_000,
              impuesto_porcentaje: 19,
            },
          ],
        },
      },
      { dice: "RESUMEN: te dejé lista la factura para que la apruebes." },
    ];
    const { modelo } = modeloGuionizado(guion);
    const tareas = new ConsumidorDeTareas({
      puertos: {
        cola: m.cola,
        sitios: new SitiosVacios(),
        backups: new BackupsEnMemoria(),
        aprobaciones,
        libros,
      },
      workerId: "w1",
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      latidoMs: 5000,
    });

    // Llega la hora, se crea el encargo y el worker lo ejecuta.
    await m.consumidor.tick();
    await tareas.tick();

    const tarea = m.cola.buscar("task_1")!;
    expect(tarea.estado).toBe("esperando_aprobacion");
    // Lo que no puede pasar bajo ningún concepto: emitir sin que nadie apruebe.
    expect(contabilidad.escrituras()).toBe(0);
    expect(aprobaciones.solicitudes).toHaveLength(1);
  });
});
