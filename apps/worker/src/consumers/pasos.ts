/**
 * El registro de trabajo de una tarea, guardado mientras corre.
 *
 * El bucle avisa de cada paso en cuanto pasa; aquí se fusionan por id y se
 * escriben en la base con cabeza: como mucho una escritura por intervalo, sin
 * esperar a la base para seguir trabajando, y sin que un fallo al guardar
 * convierta un encargo que va bien en uno fallido. La web refresca cada pocos
 * segundos, así que escribir más a menudo no enseñaría nada más.
 */
import { esPasoTrabajo, fusionarPasos, type PasoTrabajo } from "@strappy/webmaster";

export type DesenlaceTarea = "completada" | "esperando_aprobacion" | "fallida";

export class RegistroDePasos {
  #pasos: PasoTrabajo[];
  #sucio = false;
  #enVuelo: Promise<void> | null = null;
  #temporizador: ReturnType<typeof setTimeout> | null = null;
  #ultimaEscritura = 0;
  readonly #guardar: (pasos: readonly PasoTrabajo[]) => Promise<void>;
  readonly #log: (mensaje: string) => void;
  readonly #intervaloMs: number;

  constructor(o: {
    /** Lo que ya había de intentos anteriores (al reanudar tras una aprobación). */
    previos?: readonly unknown[];
    guardar: (pasos: readonly PasoTrabajo[]) => Promise<void>;
    log?: (mensaje: string) => void;
    intervaloMs?: number;
  }) {
    this.#pasos = (o.previos ?? []).filter(esPasoTrabajo);
    this.#guardar = o.guardar;
    this.#log = o.log ?? (() => {});
    this.#intervaloMs = o.intervaloMs ?? 1000;
  }

  get pasos(): readonly PasoTrabajo[] {
    return this.#pasos;
  }

  anotar(paso: PasoTrabajo): void {
    this.#pasos = fusionarPasos(this.#pasos, paso);
    this.#sucio = true;
    this.#programar();
  }

  /**
   * Última escritura. Lo que se quedó «en curso» (el bucle cortó por tiempo o
   * por error a mitad de una herramienta) se cierra según cómo acabó la tarea:
   * un spinner eterno en la web sería mentir.
   */
  async cerrar(desenlace: DesenlaceTarea): Promise<void> {
    if (this.#temporizador) {
      clearTimeout(this.#temporizador);
      this.#temporizador = null;
    }
    if (this.#enVuelo) await this.#enVuelo;
    if (this.#pasos.some((p) => p.estado === "en_curso")) {
      const final = desenlace === "fallida" ? "error" : "hecho";
      this.#pasos = this.#pasos.map((p) => (p.estado === "en_curso" ? { ...p, estado: final } : p));
      this.#sucio = true;
    }
    await this.#escribir();
  }

  #programar(): void {
    if (this.#temporizador || this.#enVuelo) return;
    const espera = Math.max(0, this.#ultimaEscritura + this.#intervaloMs - Date.now());
    this.#temporizador = setTimeout(() => {
      this.#temporizador = null;
      void this.#escribir();
    }, espera);
  }

  async #escribir(): Promise<void> {
    if (!this.#sucio) return;
    this.#sucio = false;
    this.#ultimaEscritura = Date.now();
    const foto = [...this.#pasos];
    this.#enVuelo = this.#guardar(foto)
      .catch((e: unknown) => {
        this.#log(`no se pudo guardar el registro de trabajo: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        this.#enVuelo = null;
        // Llegaron pasos mientras se escribía: van en la siguiente tanda.
        if (this.#sucio) this.#programar();
      });
    await this.#enVuelo;
  }
}
