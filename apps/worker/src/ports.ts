/**
 * Puertos del worker.
 *
 * El worker no conoce ni el driver de base de datos ni el esquema: pide a
 * puertos. Eso es lo que permite probar el bucle entero en memoria y lo que
 * hace que la corriente que escribe las migraciones y esta puedan avanzar en
 * paralelo sin pisarse.
 *
 * PENDIENTE CON LA CORRIENTE DE BASE DE DATOS: hoy no existen las tablas de
 * cola de tareas, backups ni aprobaciones. La forma que este worker necesita
 * está escrita en `sql/0011_tareas_webmaster.sql` como propuesta —no está en
 * `packages/db/migrations`, que es de otra corriente.
 */
import type { ToolApprovalResponse } from "ai";
import type { ApprovalPort, BackupPort, ConectorCreds, WpCreds } from "@strappy/webmaster";

// ---------------------------------------------------------------------------
// Driver SQL
// ---------------------------------------------------------------------------

/**
 * Lo mínimo que el worker necesita de un driver. Encajan `pg`, `postgres.js` y
 * el pool de Supabase. Se declara aquí, y no se importa de `@strappy/db`, para
 * que este paquete no dependa de la superficie de otra corriente mientras las
 * dos están en obra.
 */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlConnection>;
}

export interface SqlConnection extends SqlExecutor {
  release(): void;
}

// ---------------------------------------------------------------------------
// Cola de tareas
// ---------------------------------------------------------------------------

export type TareaReclamada = {
  readonly id: string;
  readonly workspaceId: string;
  readonly siteId: string;
  readonly agentId?: string;
  readonly titulo: string;
  readonly detalle: string | null;
  /** Cuántas veces se intentó ya. Un reintento infinito es una fuga de dinero. */
  readonly intentos: number;
  /**
   * Conversación guardada de un intento que quedó esperando aprobación.
   * Al reanudar se continúa desde aquí en vez de empezar de cero.
   */
  readonly mensajes?: readonly unknown[];
  /** Decisiones humanas que hay que inyectar antes de continuar. */
  readonly aprobaciones?: readonly ToolApprovalResponse[];
};

export type CierreTarea = {
  readonly resumen: string;
  readonly evidencia: unknown;
  readonly creditos: number;
};

export interface TaskQueuePort {
  /**
   * Reclama UNA tarea. La implementación en Postgres usa
   * `FOR UPDATE SKIP LOCKED`: varios workers pueden competir por la cola sin
   * bloquearse entre ellos y sin que dos se lleven la misma tarea.
   */
  reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<TareaReclamada | null>;
  /** Renueva el arrendamiento de una tarea larga para que nadie la robe. */
  latido(input: { taskId: string; workerId: string; arrendamientoMs: number }): Promise<void>;
  completar(input: { taskId: string; workerId: string } & CierreTarea): Promise<void>;
  /** Queda suspendida hasta que alguien decida sobre las aprobaciones. */
  suspender(input: {
    taskId: string;
    workerId: string;
    resumen: string;
    evidencia: unknown;
    creditos: number;
    mensajes: readonly unknown[];
  }): Promise<void>;
  fallar(input: {
    taskId: string;
    workerId: string;
    error: string;
    motivo: string;
    evidencia: unknown;
    reintentable: boolean;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sitios y credenciales
// ---------------------------------------------------------------------------

export type SitioConectado = {
  readonly id: string;
  readonly workspaceId: string;
  readonly tipo: "wp" | "custom";
  readonly url: string;
  readonly credenciales: WpCreds | ConectorCreds;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Si NO ha habido ninguna tarea ejecutada de verdad sobre este sitio. */
  readonly primerContacto: boolean;
};

export interface SitePort {
  cargar(input: { workspaceId: string; siteId: string }): Promise<SitioConectado | null>;
  /** Deja constancia de que el sitio ya fue tocado: se acabó la simulación. */
  marcarTocado(input: { workspaceId: string; siteId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Aviso al cliente
// ---------------------------------------------------------------------------

export interface NotificacionPort {
  avisar(input: {
    workspaceId: string;
    taskId: string;
    texto: string;
    tipo: "resultado" | "aprobacion" | "error";
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Todo lo que el consumidor de tareas necesita
// ---------------------------------------------------------------------------

export type PuertosWorker = {
  readonly cola: TaskQueuePort;
  readonly sitios: SitePort;
  readonly backups: BackupPort;
  readonly aprobaciones: ApprovalPort;
  readonly notificaciones?: NotificacionPort;
};
