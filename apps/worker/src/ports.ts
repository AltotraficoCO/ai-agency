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
import type { Cadencia, ModelMode, RateTable } from "@strappy/core";
import type { EstiloDeMarca, ImagenesPort, MediosPort } from "@strappy/disenador";
import type { Companero } from "@strappy/agentes";
import type {
  ApprovalPort,
  Aviso,
  BackupPort,
  ConectorCreds,
  EstadoVigilancia,
  WpCreds,
} from "@strappy/webmaster";
import type { AdsPort, AnalyticsPort } from "@strappy/marketing";
import type { ContabilidadPort } from "@strappy/administrativo";
import type {
  RendimientoPort as VelocistaRendimientoPort,
  SitioPort as VelocistaSitioPort,
} from "@strappy/velocista";

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
  /**
   * Conexión sobre la que se trabaja. Null cuando el encargo no va sobre un
   * sitio: un encargo de Marketing apunta a una cuenta de anuncios, y puede
   * crearse antes de que el cliente conecte ninguna.
   */
  readonly siteId: string | null;
  /**
   * Quién lo ejecuta: el slug del catálogo (`webmaster`, `marketing`…). Sin
   * valor se trata como Webmaster, que es lo que eran todos los encargos antes
   * de que hubiera más de un agente por encargo.
   */
  readonly agente?: string;
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
// Cuentas de publicidad (agente de Marketing)
// ---------------------------------------------------------------------------

/**
 * Lo que el agente de Marketing necesita para trabajar en un espacio.
 *
 * Se arma por tarea, igual que el sitio del Webmaster: las plataformas
 * conectadas son del cliente y no del proceso. Pueden llegar las tres (Google
 * Ads, Meta y TikTok), una o ninguna: un espacio sin ninguna conectada es
 * normal y el agente lo dice en vez de fallar con un error técnico.
 */
export type CuentasDeMarketing = {
  /** Conexión principal del encargo, si la hay: sobre ella cuelgan las aprobaciones. */
  readonly conexionId: string | null;
  readonly ads: readonly AdsPort[];
  readonly analytics?: AnalyticsPort;
  /** Nombre del negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Primer contacto con las cuentas: mira y propone, no cambia nada. */
  readonly primerContacto?: boolean;
  /** Credenciales descifradas: se tapan en todo lo que lea el cliente. */
  readonly secretos?: readonly string[];
};

export interface CuentasPort {
  cargar(input: {
    workspaceId: string;
    conexionId: string | null;
  }): Promise<CuentasDeMarketing>;
}

// ---------------------------------------------------------------------------
// Libros del negocio (agente financiero)
// ---------------------------------------------------------------------------

/**
 * Lo que el agente financiero necesita para trabajar en un espacio.
 *
 * Se arma por tarea, igual que el sitio del Webmaster: el sistema de
 * facturación es del cliente y no del proceso. Sin conexión llega sin
 * `contabilidad` y el agente lo explica en vez de fallar.
 */
export type LibrosDelNegocio = {
  /** Conexión del encargo, si la hay: sobre ella cuelgan las aprobaciones. */
  readonly conexionId: string | null;
  readonly contabilidad?: ContabilidadPort;
  /** Nombre del negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Primer contacto con la contabilidad: mira y propone, no emite nada. */
  readonly primerContacto?: boolean;
  /** Credenciales descifradas: se tapan en todo lo que lea el cliente. */
  readonly secretos?: readonly string[];
};

export interface LibrosPort {
  cargar(input: { workspaceId: string; conexionId: string | null }): Promise<LibrosDelNegocio>;
}

// ---------------------------------------------------------------------------
// El estudio del Diseñador
// ---------------------------------------------------------------------------

/**
 * Lo que el Diseñador necesita para trabajar en un espacio: con qué dibuja,
 * con qué colores y dónde publica.
 *
 * Sin generador (falta la clave de la cartera) o sin sitio conectado llega a
 * medias y el agente lo explica con sus palabras, igual que hacen el de
 * Marketing y el financiero.
 */
export type EstudioDeDiseno = {
  /** Conexión del encargo, si la hay: sobre ella cuelgan las aprobaciones. */
  readonly conexionId: string | null;
  readonly imagenes?: ImagenesPort;
  readonly medios?: MediosPort;
  /** Colores y tipografías medidos del sitio real, si se pudieron leer. */
  readonly estilo?: EstiloDeMarca;
  readonly negocio: string;
  readonly agentName: string;
  /** Primer contacto: diseña, pero no sube nada al sitio. */
  readonly primerContacto?: boolean;
};

export interface EstudioPort {
  cargar(input: {
    workspaceId: string;
    siteId: string | null;
    taskId: string;
    modo: ModelMode;
  }): Promise<EstudioDeDiseno>;
}

/**
 * Lo mínimo que los adaptadores de `@strappy/db` piden como ámbito de tenant.
 *
 * El worker se conecta con el rol de servicio y cruza espacios al reclamar, así
 * que aquí el ámbito es solo la etiqueta del espacio con la que se lee y se
 * cobra. Se declara con esta forma para no arrastrar el tipo entero de la base.
 */
export type TenantScopeMinimo = {
  readonly workspaceId: string;
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  assertSameWorkspace(otro: string): void;
};

// Velocidad del sitio (Velocista)
// ---------------------------------------------------------------------------

/**
 * Lo que el Velocista necesita para trabajar en un espacio.
 *
 * El medidor va aparte del sitio a propósito: se puede medir una web sin tener
 * sus credenciales —la velocidad se mide desde fuera, como la mide un
 * visitante—, pero para revisar sus imágenes o instalar caché sí hace falta el
 * WordPress conectado. Sin clave de medición, `rendimiento.disponible` es false
 * y el agente lo dice en vez de inventarse un tiempo.
 */
export type VelocidadDelSitio = {
  readonly conexionId: string | null;
  readonly sitio?: VelocistaSitioPort;
  readonly rendimiento?: VelocistaRendimientoPort;
  /** Nombre del negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Primer contacto con el sitio: mide y propone, no instala nada. */
  readonly primerContacto?: boolean;
  /** Credenciales descifradas: se tapan en todo lo que lea el cliente. */
  readonly secretos?: readonly string[];
};

export interface VelocistaPort {
  cargar(input: { workspaceId: string; conexionId: string | null }): Promise<VelocidadDelSitio>;
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

// ---------------------------------------------------------------------------
// La plantilla del cliente
// ---------------------------------------------------------------------------

/**
 * Quién más trabaja para este cliente. Con esto un agente puede encargarle una
 * parte a otro; sin esto, cada uno trabaja solo, que es como trabajaban antes.
 */
export interface NominaPort {
  companeros(input: { workspaceId: string; exceptoSlug: string }): Promise<readonly Companero[]>;
  /**
   * Cómo se llama un agente contratado, según `agents.name` (que para los del
   * catálogo es su puesto). null si no existe. Es la única fuente del nombre:
   * el `agent_name` guardado en cada conexión es una copia vieja.
   */
  nombreDe(input: { workspaceId: string; agentId: string }): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Avisar al dueño por su propio WhatsApp
// ---------------------------------------------------------------------------

export type ResultadoEnvio =
  | { readonly enviado: true }
  | { readonly enviado: false; readonly motivo: string };

/**
 * Mandar un mensaje al dueño del negocio, no a sus clientes.
 *
 * Va aparte del canal de conversaciones a propósito: aquí no hay contacto ni
 * hilo, es el agente avisando a su jefe. Y cuesta dinero del cliente —Meta le
 * cobra a él cada conversación—, así que quien lo implemente tiene que poder
 * negarse a enviar y decir por qué.
 */
export interface MensajeriaPort {
  avisarAlDueno(input: {
    workspaceId: string;
    titulo: string;
    cuerpo: string;
    propuesta?: string;
  }): Promise<ResultadoEnvio>;
}

// ---------------------------------------------------------------------------
// Todo lo que el consumidor de tareas necesita
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Trabajo programado
// ---------------------------------------------------------------------------

/** Un trabajo repetido al que le toca la hora. */
export type ProgramadoReclamado = {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string;
  /** Slug del catálogo: quién lo ejecutará (`webmaster`, `administrativo`…). */
  readonly agente: string;
  readonly titulo: string;
  readonly detalle: string;
  readonly cadencia: Cadencia;
  /** Para cuándo estaba previsto. Si se llegó muy tarde, se salta. */
  readonly previstaEn: Date;
};

/**
 * La cola del trabajo programado.
 *
 * No ejecuta agentes: crea encargos. Cuando llega la hora, `lanzar` inserta una
 * fila en `agent_tasks` y a partir de ahí es un encargo como cualquier otro, con
 * su enrutado, sus aprobaciones, su registro en vivo y su cobro.
 */
export interface ProgramadorPort {
  /** Reclama el programado que vence antes. Null si no toca ninguno. */
  reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<ProgramadoReclamado | null>;
  /** Crea el encargo y programa la siguiente. Devuelve el id del encargo. */
  lanzar(input: {
    id: string;
    workerId: string;
    programado: ProgramadoReclamado;
    proxima: Date;
  }): Promise<string | null>;
  /** Solo programa la siguiente: esta se saltó por llegar demasiado tarde. */
  reprogramar(input: { id: string; workerId: string; proxima: Date }): Promise<void>;
  /**
   * Se apaga sola y se explica por qué (`sin_creditos`, `agente_de_baja`). Un
   * programado que falla cada mañana es peor que uno apagado con su motivo.
   */
  pausar(input: { id: string; workerId: string; motivo: string }): Promise<void>;
  /** Créditos disponibles del espacio: sin saldo no se crean encargos. */
  saldo(workspaceId: string): Promise<number>;
  /** Apaga los programados de agentes que ya no están contratados. */
  sincronizar(): Promise<number>;
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
  /** Sin él, un encargo de Marketing dice que falta conectar las plataformas. */
  readonly cuentas?: CuentasPort;
  /** Sin él, un encargo financiero dice que falta conectar la facturación. */
  readonly libros?: LibrosPort;
  /** Sin él, el Diseñador dice que hoy no puede dibujar. */
  readonly estudio?: EstudioPort;
  /** Sin él, un encargo de velocidad dice que no hay con qué medir. */
  readonly velocidad?: VelocistaPort;
  /** Sin él, ningún agente puede pedirle ayuda a un compañero. */
  readonly nomina?: NominaPort;
};
