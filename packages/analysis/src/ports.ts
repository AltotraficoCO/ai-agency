/**
 * Puertos del análisis.
 *
 * Ni un nombre de tabla ni un cliente concreto: el paquete pide formas. Quien
 * implemente estos puertos decide si eso es Postgres, Supabase o memoria.
 */
import type { ModelMode } from "@strappy/core";
import type { AnalisisGuardable, MotivoCierre, ResultadoAnalisis } from "./tipos.js";
import type { VariableDeAgente } from "./variables.js";
import type { Automatizacion, EjecucionDeAutomatizacion } from "./automatizaciones.js";
import type { SugerenciaDeMejora } from "./mejora.js";

/** Lo que el análisis necesita saber del agente para construir su esquema. */
export type ConfigDeAnalisis = {
  readonly agentId: string;
  readonly workspaceId: string;
  readonly nombre: string;
  readonly modo: ModelMode;
  /** El objetivo en lenguaje natural. Es el criterio ÚNICO del juez. */
  readonly objetivo?: string;
  readonly variables: readonly VariableDeAgente[];
  readonly idioma?: string;
};

export interface AgenteAnalizadoPort {
  cargar(input: { workspaceId: string; agentId: string }): Promise<ConfigDeAnalisis | null>;
}

export interface TranscriptoPort {
  cargar(input: { workspaceId: string; conversationId: string }): Promise<
    import("./tipos.js").Transcripto | null
  >;
}

export interface AnalisisStorePort {
  guardar(analisis: AnalisisGuardable): Promise<{ id: string }>;
}

export interface AutomatizacionesPort {
  listarActivas(input: { workspaceId: string; agentId?: string }): Promise<readonly Automatizacion[]>;
  registrarEjecucion(run: EjecucionDeAutomatizacion): Promise<void>;
}

/** Contexto que recibe cada acción. Es lo único que el ejecutor puede mirar. */
export type ContextoDeAccion = {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly analisisId?: string;
  readonly resultado: ResultadoAnalisis;
  readonly motivoCierre: MotivoCierre;
};

export type ResultadoAccion = {
  readonly ok: boolean;
  readonly detalle?: string;
};

export interface EjecutorDeAccionesPort {
  ejecutar(
    accion: import("./automatizaciones.js").Accion,
    contexto: ContextoDeAccion,
  ): Promise<ResultadoAccion>;
}

/** Materia prima del ciclo de mejora. */
export type ObjecionRegistrada = {
  readonly texto: string;
  readonly conversationId: string;
  readonly detectadaEl: Date;
};

export interface SugerenciasPort {
  objeciones(input: {
    workspaceId: string;
    agentId: string;
    desde: Date;
    hasta: Date;
  }): Promise<readonly ObjecionRegistrada[]>;
  /** Cuántas conversaciones se analizaron en la ventana. Denominador del porcentaje. */
  conversacionesAnalizadas(input: {
    workspaceId: string;
    agentId: string;
    desde: Date;
    hasta: Date;
  }): Promise<number>;
  guardar(sugerencia: SugerenciaDeMejora): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cola
// ---------------------------------------------------------------------------

export type TrabajoDeAnalisis = {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly motivoCierre: MotivoCierre;
  readonly intentos: number;
};

export interface ColaDeAnalisisPort {
  /** Reclama UN trabajo. En Postgres, con `FOR UPDATE SKIP LOCKED`. */
  reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<TrabajoDeAnalisis | null>;
  completar(input: { id: string; workerId: string; analisisId: string }): Promise<void>;
  fallar(input: {
    id: string;
    workerId: string;
    error: string;
    reintentable: boolean;
  }): Promise<void>;
}
