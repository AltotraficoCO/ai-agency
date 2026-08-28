/**
 * Tipos del análisis post-conversación.
 *
 * Todo lo que entra y sale de aquí es dato plano: el análisis se guarda, se
 * compara entre versiones y se reprocesa, así que nada puede depender de un
 * cliente de base de datos ni de un objeto vivo del motor.
 */

/** Quién escribió cada línea del transcript. */
export type RolTranscrito = "contacto" | "agente" | "humano" | "sistema";

export type MensajeTranscrito = {
  readonly rol: RolTranscrito;
  readonly texto: string;
  readonly enviadoEl: Date;
};

/** Por qué se cerró la conversación. El cierre es lo que encola el análisis. */
export type MotivoCierre = "inactividad" | "traspaso" | "explicito" | "limite_turnos";

export type Transcripto = {
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly agentRunId?: string;
  readonly mensajes: readonly MensajeTranscrito[];
  readonly motivoCierre: MotivoCierre;
};

export type Sentimiento = "positivo" | "neutro" | "negativo";

/** Valor de una variable extraída. Escalar a propósito: entra en `jsonb` y se segmenta con GIN. */
export type ValorExtraido = string | number | boolean | null;

export type ResultadoAnalisis = {
  readonly resumen: string;
  readonly objetivoLogrado: boolean;
  /** 0–100. Es lo que alimenta el embudo «Metas logradas». */
  readonly objetivoScore: number;
  readonly objetivoRazon: string;
  readonly sentimiento: Sentimiento;
  /** Objeciones detectadas, en las palabras del contacto. Alimenta el ciclo de mejora. */
  readonly objeciones: readonly string[];
  readonly variables: Readonly<Record<string, ValorExtraido>>;
  readonly modelo: string;
  readonly mensajesAlAnalizar: number;
  readonly analizadoEl: Date;
};

/** Lo que se persiste. El puerto decide en qué tabla y con qué nombres. */
export type AnalisisGuardable = {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly agentRunId?: string;
  readonly motivoCierre: MotivoCierre;
  readonly resultado: ResultadoAnalisis;
};
