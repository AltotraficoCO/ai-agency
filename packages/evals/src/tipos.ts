/**
 * Tipos comunes de la evaluación.
 *
 * El agente bajo prueba entra por un puerto: aquí no se sabe si detrás hay el
 * motor entero, un borrador sin publicar o un doble de ensayo. Eso es lo que
 * permite correr el humo dentro del flujo de publicación sin arrastrar medio
 * sistema, y probar este paquete sin clave de modelo.
 */
export type TurnoDePrueba = {
  readonly rol: "contacto" | "agente";
  readonly texto: string;
};

export type RespuestaDeAgente = {
  readonly texto: string;
  readonly latenciaMs: number;
  /** Si el turno recuperó algo del cerebro del agente. */
  readonly usoConocimiento?: boolean;
  readonly fragmentos?: readonly string[];
};

export interface AgenteBajoPruebaPort {
  responder(input: {
    readonly historial: readonly TurnoDePrueba[];
    readonly mensaje: string;
  }): Promise<RespuestaDeAgente>;
}

export type ConversacionSintetica = {
  readonly id: string;
  readonly etiqueta: string;
  readonly turnos: readonly TurnoDePrueba[];
  readonly latenciaMaxMs: number;
  readonly latenciaTotalMs: number;
};

/** Un veredicto del juez sobre un caso. */
export type Veredicto = {
  /** 0–100. Comparable entre versiones: es lo que produce el diff. */
  readonly puntuacion: number;
  readonly aprobado: boolean;
  readonly razon: string;
};
