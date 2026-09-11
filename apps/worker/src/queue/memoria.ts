/**
 * Cola en memoria. Existe para los tests y para levantar el worker sin base de
 * datos; imita el arrendamiento y el tope de intentos de la de Postgres para
 * que lo que se prueba aquí sea lo mismo que se ejecuta allí.
 */
import type { CierreTarea, TareaReclamada, TaskQueuePort } from "../ports.js";

export type TareaEnMemoria = { -readonly [K in keyof TareaReclamada]: TareaReclamada[K] } & {
  estado: "queued" | "running" | "done" | "failed" | "esperando_aprobacion";
  workerId?: string;
  leaseHasta?: number;
  resumen?: string;
  evidencia?: unknown;
  creditos?: number;
  error?: string;
  errorMotivo?: string;
};

export class ColaEnMemoria implements TaskQueuePort {
  readonly tareas: TareaEnMemoria[] = [];
  readonly #maxIntentos: number;
  #ahora: () => number;

  constructor(o: { maxIntentos?: number; now?: () => number } = {}) {
    this.#maxIntentos = o.maxIntentos ?? 3;
    this.#ahora = o.now ?? (() => Date.now());
  }

  encolar(t: Omit<TareaReclamada, "intentos"> & { intentos?: number }): TareaEnMemoria {
    const fila: TareaEnMemoria = { ...t, intentos: t.intentos ?? 0, estado: "queued" };
    this.tareas.push(fila);
    return fila;
  }

  buscar(id: string): TareaEnMemoria | undefined {
    return this.tareas.find((t) => t.id === id);
  }

  async reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<TareaReclamada | null> {
    const ahora = this.#ahora();
    const fila = this.tareas.find(
      (t) =>
        t.intentos < this.#maxIntentos &&
        (t.estado === "queued" || (t.estado === "running" && (t.leaseHasta ?? 0) < ahora)),
    );
    if (!fila) return null;
    fila.estado = "running";
    fila.workerId = input.workerId;
    fila.leaseHasta = ahora + input.arrendamientoMs;
    fila.intentos += 1;
    return { ...fila };
  }

  async latido(input: { taskId: string; workerId: string; arrendamientoMs: number }): Promise<void> {
    const t = this.buscar(input.taskId);
    if (t && t.workerId === input.workerId) t.leaseHasta = this.#ahora() + input.arrendamientoMs;
  }

  async completar(input: { taskId: string; workerId: string } & CierreTarea): Promise<void> {
    const t = this.buscar(input.taskId);
    if (!t || t.workerId !== input.workerId) return;
    Object.assign(t, {
      estado: "done" as const,
      resumen: input.resumen,
      evidencia: input.evidencia,
      creditos: input.creditos,
      leaseHasta: undefined,
    });
  }

  async suspender(input: {
    taskId: string;
    workerId: string;
    resumen: string;
    evidencia: unknown;
    creditos: number;
    mensajes: readonly unknown[];
  }): Promise<void> {
    const t = this.buscar(input.taskId);
    if (!t || t.workerId !== input.workerId) return;
    Object.assign(t, {
      estado: "esperando_aprobacion" as const,
      resumen: input.resumen,
      evidencia: input.evidencia,
      creditos: (t.creditos ?? 0) + input.creditos,
      mensajes: input.mensajes,
      intentos: Math.max(0, t.intentos - 1),
      leaseHasta: undefined,
    });
  }

  async fallar(input: {
    taskId: string;
    workerId: string;
    error: string;
    motivo: string;
    evidencia: unknown;
    reintentable: boolean;
  }): Promise<void> {
    const t = this.buscar(input.taskId);
    if (!t || t.workerId !== input.workerId) return;
    const reintenta = input.reintentable && t.intentos < this.#maxIntentos;
    Object.assign(t, {
      estado: reintenta ? ("queued" as const) : ("failed" as const),
      error: input.error,
      errorMotivo: input.motivo,
      evidencia: input.evidencia,
      leaseHasta: undefined,
    });
  }

  async registrarPasos(input: { taskId: string; workerId: string; pasos: readonly unknown[] }): Promise<void> {
    const t = this.buscar(input.taskId);
    if (!t || t.workerId !== input.workerId) return;
    t.pasos = [...input.pasos];
  }
}
