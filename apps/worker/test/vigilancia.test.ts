/**
 * El consumidor de vigilancia, de punta a punta contra el doble de WordPress.
 *
 * Lo que hay que verificar no es que compile, sino tres promesas que le
 * hacemos al cliente: que un fallo aislado no le llega como una alarma, que una
 * caída de verdad le llega UNA vez, y que vigilar su web no le cuesta créditos
 * ni le cambia nada del sitio.
 */
import { describe, expect, it } from "vitest";
import {
  BASE_DOBLE,
  crearDobleWordPress,
  type DobleWordPress,
} from "@strappy/webmaster/testing";
import type { Aviso, EstadoVigilancia } from "@strappy/webmaster";
import { ConsumidorDeVigilancia } from "../src/consumers/vigilancia.js";
import type { SitePort, SitioConectado, SitioVigilado, VigilanciaPort } from "../src/ports.js";

// ---------------------------------------------------------------------------

class SitiosEnMemoria implements SitePort {
  constructor(private readonly sitio: SitioConectado | null) {}
  async cargar(): Promise<SitioConectado | null> {
    return this.sitio;
  }
  async marcarTocado(): Promise<void> {}
}

class VigilanciaEnMemoria implements VigilanciaPort {
  estado: EstadoVigilancia = {};
  cadaMinutos = 15;
  pendiente = true;
  guardados: { estado: EstadoVigilancia; proximaEnMs: number }[] = [];
  avisos: Aviso[] = [];
  altas = 0;

  async reclamar(): Promise<SitioVigilado | null> {
    if (!this.pendiente) return null;
    this.pendiente = false;
    return {
      siteId: "site_1",
      workspaceId: "ws_1",
      estado: this.estado,
      cadaMinutos: this.cadaMinutos,
    };
  }

  async guardar(input: { estado: EstadoVigilancia; proximaEnMs: number }): Promise<void> {
    this.estado = input.estado;
    this.guardados.push({ estado: input.estado, proximaEnMs: input.proximaEnMs });
  }

  async registrarAvisos(input: { avisos: readonly Aviso[] }): Promise<number> {
    this.avisos.push(...input.avisos);
    return input.avisos.length;
  }

  async sincronizar(): Promise<number> {
    this.altas += 1;
    return 0;
  }

  /** Otra ronda: como si hubiera pasado el intervalo. */
  siguienteRonda(): void {
    this.pendiente = true;
  }
}

function montar(o: { caido?: boolean } = {}) {
  const wp: DobleWordPress = crearDobleWordPress();
  const sitio: SitioConectado = {
    id: "site_1",
    workspaceId: "ws_1",
    tipo: "wp",
    url: BASE_DOBLE,
    credenciales: { url: BASE_DOBLE, user: wp.estado.usuario, appPassword: wp.estado.appPassword },
    agentName: "Jaime",
    primerContacto: false,
  };
  const vigilancia = new VigilanciaEnMemoria();
  const entregados: Aviso[] = [];
  let caido = o.caido ?? false;
  let minutos = 0;

  // El sitio se cae y se levanta a voluntad: es lo que hay que poder simular.
  const fetchSitio: typeof globalThis.fetch = async (entrada, init) => {
    if (caido) throw new Error("sin conexión");
    return wp.fetch(entrada, init);
  };

  const consumidor = new ConsumidorDeVigilancia({
    vigilancia,
    sitios: new SitiosEnMemoria(sitio),
    workerId: "worker_test",
    fetchSitio,
    ahora: () => new Date(Date.UTC(2026, 8, 11, 10, minutos, 0)),
    alAvisar: async ({ aviso }) => {
      entregados.push(aviso);
    },
  });

  return {
    consumidor,
    vigilancia,
    wp,
    entregados,
    caer: () => {
      caido = true;
    },
    levantar: () => {
      caido = false;
    },
    avanzar: (m: number) => {
      minutos += m;
    },
  };
}

// ---------------------------------------------------------------------------

describe("consumidor de vigilancia", () => {
  it("sin sitios que tocar no hace nada y lo dice", async () => {
    const { consumidor, vigilancia } = montar();
    vigilancia.pendiente = false;
    expect(await consumidor.tick()).toBe(false);
  });

  it("un sitio sano no genera avisos y se reprograma", async () => {
    const { consumidor, vigilancia } = montar();

    expect(await consumidor.tick()).toBe(true);
    expect(vigilancia.avisos).toEqual([]);
    expect(vigilancia.guardados.at(-1)?.proximaEnMs).toBe(15 * 60 * 1000);
  });

  it("un fallo aislado no avisa; el segundo sí, y una sola vez", async () => {
    const v = montar();

    v.caer();
    await v.consumidor.tick();
    expect(v.vigilancia.avisos).toEqual([]);
    expect(v.vigilancia.estado.sospechaDesde).toBeTruthy();

    v.avanzar(15);
    v.vigilancia.siguienteRonda();
    await v.consumidor.tick();
    expect(v.vigilancia.avisos).toHaveLength(1);
    expect(v.vigilancia.avisos[0]!.severidad).toBe("grave");
    expect(v.entregados).toHaveLength(1);

    v.avanzar(15);
    v.vigilancia.siguienteRonda();
    await v.consumidor.tick();
    expect(v.vigilancia.avisos).toHaveLength(1);
  });

  it("cuando el sitio vuelve, avisa de la recuperación", async () => {
    const v = montar();

    v.caer();
    await v.consumidor.tick();
    v.avanzar(15);
    v.vigilancia.siguienteRonda();
    await v.consumidor.tick();

    v.levantar();
    v.avanzar(15);
    v.vigilancia.siguienteRonda();
    await v.consumidor.tick();

    expect(v.vigilancia.avisos).toHaveLength(2);
    expect(v.vigilancia.avisos[1]!.severidad).toBe("bueno");
    expect(v.vigilancia.estado.caido).toBe(false);
  });

  it("vigilar no escribe nada en el sitio del cliente", async () => {
    const v = montar();
    await v.consumidor.tick();

    const escrituras = v.wp.llamadas.filter((l) => l.metodo !== "GET");
    expect(escrituras).toEqual([]);
  });

  it("da de alta los sitios nuevos de vez en cuando, no en cada vuelta", async () => {
    const v = montar();

    await v.consumidor.tick();
    expect(v.vigilancia.altas).toBe(1);

    v.vigilancia.siguienteRonda();
    await v.consumidor.tick();
    expect(v.vigilancia.altas).toBe(1);

    v.avanzar(11);
    v.vigilancia.siguienteRonda();
    await v.consumidor.tick();
    expect(v.vigilancia.altas).toBe(2);
  });

  it("un sitio que no se puede cargar se aparta una hora en vez de reintentar sin fin", async () => {
    const vigilancia = new VigilanciaEnMemoria();
    const consumidor = new ConsumidorDeVigilancia({
      vigilancia,
      sitios: {
        async cargar() {
          throw new Error("Las credenciales guardadas son indescifrables con la clave actual.");
        },
        async marcarTocado() {},
      },
      workerId: "worker_test",
    });

    expect(await consumidor.tick()).toBe(true);
    expect(vigilancia.avisos).toEqual([]);
    expect(vigilancia.guardados.at(-1)?.proximaEnMs).toBe(60 * 60 * 1000);
  });
});
