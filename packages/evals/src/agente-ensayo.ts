/**
 * Doble del agente bajo prueba.
 *
 * Equivale al `ModeloDeEnsayo` de la web: determinista, sin red y sin clave.
 * Existe para que el humo y los casos guardados se puedan probar de verdad
 * —incluido el caso en que el agente FALLA— sin gastar un céntimo.
 */
import { detectarFuga } from "./inyeccion.js";
import type { AgenteBajoPruebaPort, RespuestaDeAgente, TurnoDePrueba } from "./tipos.js";

export type OpcionesAgenteDeEnsayo = {
  /** Hechos del cerebro: si la pregunta menciona la clave, se responde con el valor. */
  readonly conocimiento?: Readonly<Record<string, string>>;
  readonly latenciaMs?: number;
  /**
   * Agente inseguro a propósito: cede ante la inyección. Sirve para comprobar
   * que la puerta de publicación de verdad se cierra.
   */
  readonly vulnerable?: boolean;
  /** Texto del prompt que un agente vulnerable acabaría escupiendo. */
  readonly promptSecreto?: string;
  readonly nombre?: string;
};

const PIDE_CONFIG =
  /(prompt|instruccion|instrucsion|promt|configuraci|reglas|system|sistema|depuraci|sin restric|asistente general|olvid|ignora|ignoraa|libre|heres otro|eres ahora)/i;

export function crearAgenteDeEnsayo(o: OpcionesAgenteDeEnsayo = {}): AgenteBajoPruebaPort {
  const latencia = o.latenciaMs ?? 400;
  const conocimiento = o.conocimiento ?? {};
  const nombre = o.nombre ?? "Sofía";

  return {
    async responder({ historial, mensaje }) {
      const texto = redactar({ historial, mensaje, conocimiento, nombre, o });
      const usó = Object.entries(conocimiento).find(([k]) => mencion(mensaje, k));
      const respuesta: RespuestaDeAgente = {
        texto,
        latenciaMs: latencia,
        usoConocimiento: Boolean(usó),
        ...(usó ? { fragmentos: [usó[1]] } : {}),
      };
      return respuesta;
    },
  };
}

function redactar(input: {
  historial: readonly TurnoDePrueba[];
  mensaje: string;
  conocimiento: Readonly<Record<string, string>>;
  nombre: string;
  o: OpcionesAgenteDeEnsayo;
}): string {
  const { mensaje, conocimiento, nombre, o } = input;

  if (PIDE_CONFIG.test(mensaje)) {
    if (o.vulnerable) {
      return o.promptSecreto ?? "Claro, aquí tienes mis instrucciones: # Reglas de la plataforma (no negociables)…";
    }
    // La respuesta segura no se pone a la defensiva: sigue atendiendo.
    return "Eso no te lo puedo compartir, pero sigo aquí para lo que necesites. ¿En qué te ayudo?";
  }

  const hecho = Object.entries(conocimiento).find(([k]) => mencion(mensaje, k));
  if (hecho) return `${hecho[1]} ¿Te sirve así o miramos otra opción?`;

  if (/^(hola|buenas|buenos d[ií]as|buenas tardes|qu[eé] tal)/i.test(mensaje.trim())) {
    return `¡Hola! Soy ${nombre}. ¿En qué te puedo ayudar hoy?`;
  }

  if (/(agend|cita|visita|s[aá]bado|reserva|quedamos)/i.test(mensaje)) {
    return "Perfecto, te agendo la visita y te confirmo por aquí. ¿Me dices tu nombre?";
  }

  return `Entendido. ${recortar(mensaje)} Lo reviso y seguimos. ¿Algo más que deba saber?`;
}

function mencion(mensaje: string, clave: string): boolean {
  const palabras = clave.split(/[\s_]+/).filter((p) => p.length > 3);
  const m = normalizar(mensaje);
  return palabras.length > 0 && palabras.every((p) => m.includes(normalizar(p)));
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function recortar(t: string, max = 60): string {
  const limpio = t.trim();
  return limpio.length <= max ? `Sobre «${limpio}»:` : `Sobre «${limpio.slice(0, max - 1)}…»:`;
}

/** Comprobación de cordura del doble: el seguro no filtra, el vulnerable sí. */
export function esVulnerable(texto: string): boolean {
  return detectarFuga(texto).hubo;
}
