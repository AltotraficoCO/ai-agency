/**
 * Puertos del worker.
 *
 * El worker no conoce ni el driver de base de datos ni el esquema: pide a
 * puertos. Eso es lo que permite probar el bucle entero en memoria.
 *
 * Las tablas de cola de tareas, backups y aprobaciones están en
 * `packages/db/migrations/0015_tareas_webmaster.sql`.
 */
import type { LanguageModel, ToolApprovalResponse } from "ai";
import type { RateTable } from "@strappy/core";
import type {
  ApprovalPort,
  Aviso,
  BackupPort,
  ConectorCreds,
  EstadoVigilancia,
  WpCreds,
} from "@strappy/webmaster";

// ---------------------------------------------------------------------------
// Driver SQL
// ---------------------------------------------------------------------------

/**
 * Lo mínimo que el worker necesita de un driver. Encajan `pg`, `postgres.js` y
 * el pool de Supabase.
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
  /** Registro de trabajo de intentos anteriores: al reanudar se sigue añadiendo. */
  readonly pasos?: readonly unknown[];
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
  /**
   * Guarda el registro de trabajo mientras la tarea corre, para que la web lo
   * enseñe en vivo. Sobrescribe la lista entera: quien llama ya fusionó.
   */
  registrarPasos(input: { taskId: string; workerId: string; pasos: readonly unknown[] }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Modelo y créditos de cada tarea
// ---------------------------------------------------------------------------

/**
 * Con qué modelo se ejecuta una tarea y a quién se le cobra.
 *
 * Se decide POR TAREA, no al arrancar: el modelo depende del plan del espacio
 * y del modo del agente, y un mismo worker atiende a clientes con planes
 * distintos.
 */
export type MotorTarea = {
  readonly model: LanguageModel;
  /** Identificador canónico de `model_tiers`: es con el que se tarifica. */
  readonly modelId: string;
  readonly modo?: "lite" | "max";
  readonly rates: RateTable;
  /** Créditos disponibles del espacio. Sin saldo no se empieza a gastar. */
  saldo?(): Promise<number>;
  /** Descuenta lo que costó un intento. `clave` hace que reintentar el cobro no cobre dos veces. */
  cobrar?(input: {
    creditos: number;
    clave: string;
    detalle: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void>;
};

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
// Vigilancia proactiva del sitio
// ---------------------------------------------------------------------------

/** Un sitio al que le toca ronda de comprobaciones. */
export type SitioVigilado = {
  readonly siteId: string;
  readonly workspaceId: string;
  /** Lo que se recuerda de la ronda anterior (`EstadoVigilancia`). */
  readonly estado: EstadoVigilancia;
  readonly cadaMinutos: number;
};

/**
 * La cola de la vigilancia. Es la misma idea que la de tareas —reclamar con
 * arrendamiento para que dos workers no comprueben el mismo sitio— pero la
 * unidad de trabajo no es un encargo del cliente sino una ronda periódica.
 */
export interface VigilanciaPort {
  /** Reclama el sitio cuya ronda vence antes. Null si no toca ninguna. */
  reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<SitioVigilado | null>;
  /** Guarda la memoria de la ronda y programa la siguiente. */
  guardar(input: {
    siteId: string;
    workerId: string;
    estado: EstadoVigilancia;
    chequeo: unknown;
    /** Dentro de cuánto toca la próxima ronda. */
    proximaEnMs: number;
  }): Promise<void>;
  /**
   * Anota los avisos. Repetir una ronda no puede duplicarlos: la unicidad va
   * por (sitio, clave) y la clave lleva dentro el momento del cambio.
   */
  registrarAvisos(input: {
    workspaceId: string;
    siteId: string;
    avisos: readonly Aviso[];
  }): Promise<number>;
  /**
   * Da de alta en la vigilancia los sitios conectados que todavía no están.
   * Se llama de vez en cuando: un sitio recién conectado no debe esperar a un
   * reinicio del worker para empezar a vigilarse.
   */
  sincronizar(): Promise<number>;
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
