/**
 * El bucle del proceso: atiende a los consumidores y se apaga sin dejar
 * trabajo a medias.
 *
 * Cuando alguien hace trabajo se vuelve a preguntar enseguida; cuando nadie
 * tiene nada, se duerme el intervalo. Un `setInterval` fijo hace lo contrario
 * de lo que conviene: espera cuando hay cola y consulta cuando no la hay.
 */
import type { Consumidor } from "./consumers/tipos.js";

export type OpcionesRunner = {
  readonly consumidores: readonly Consumidor[];
  readonly pollMs?: number;
  readonly log?: (mensaje: string) => void;
};

export class Runner {
  #parando = false;
  #enVuelo: Promise<void> | null = null;
  readonly #o: OpcionesRunner;

  constructor(o: OpcionesRunner) {
    this.#o = o;
  }

  /** Una vuelta por todos los consumidores. Devuelve si alguien hizo trabajo. */
  async vuelta(): Promise<boolean> {
    let hubo = false;
    for (const c of this.#o.consumidores) {
      if (this.#parando) break;
      try {
        const trabajo = c.tick();
        // El rechazo se absorbe AQUI a proposito. `trabajo` ya se espera abajo
        // dentro del try, asi que el error se registra; pero esta promesa
        // derivada es otra, y si quedara rechazada sin nadie que la mire, Node
        // mata el proceso entero. Paso de verdad: un consumidor consulto una
        // tabla que aun no existia y dejo sin servicio al Webmaster, que es lo
        // unico que factura. Un consumidor que falla no puede tumbar a los demas.
        this.#enVuelo = trabajo.then(
          () => undefined,
          () => undefined,
        );
        if (await trabajo) hubo = true;
      } catch (e) {
        this.#o.log?.(`[${c.nombre}] ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.#enVuelo = null;
      }
    }
    return hubo;
  }

  async arrancar(): Promise<void> {
    const pollMs = this.#o.pollMs ?? 3000;
    while (!this.#parando) {
      const hubo = await this.vuelta();
      if (this.#parando) break;
      if (!hubo) await dormir(pollMs);
    }
  }

  /**
   * Apagado ordenado: se deja de reclamar trabajo nuevo y se espera al que
   * está en vuelo. Matar una tarea a mitad deja el sitio del cliente en un
   * estado que nadie escribió en ninguna parte.
   */
  async parar(): Promise<void> {
    this.#parando = true;
    if (this.#enVuelo) await this.#enVuelo.catch(() => {});
    for (const c of this.#o.consumidores) await c.cerrar?.().catch(() => {});
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
