/**
 * Límite de ritmo por `phone_number_id`.
 *
 * Meta aplica dos límites distintos y confundirlos cuesta caro:
 *  - Rendimiento (mensajes por segundo) del número.
 *  - Destinatarios únicos por 24h, que es lo que define el nivel de mensajería.
 * Aquí modelamos el primero como cubo de fichas, y exponemos el segundo para
 * que la cola pueda avisar antes de quemar la cuota diaria del cliente.
 *
 * Es un limitador en memoria, por proceso. Con varios trabajadores hace falta
 * uno compartido; la interfaz `LimitadorRitmo` está pensada para sustituirlo.
 */
import type { MessagingTier } from "./types.js";

/** Destinatarios únicos que el número puede iniciar en 24h según su nivel. */
export const DESTINATARIOS_POR_NIVEL: Record<MessagingTier, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: Number.POSITIVE_INFINITY,
  TIER_UNKNOWN: 50,
};

/**
 * Mensajes por segundo. Meta arranca en 80 mps y sube hasta 1000 en números
 * consolidados; los niveles bajos no llegan nunca a ese techo, así que se
 * limitan más abajo para no provocar 130429 en cascada.
 */
export const MPS_POR_NIVEL: Record<MessagingTier, number> = {
  TIER_50: 5,
  TIER_250: 10,
  TIER_1K: 20,
  TIER_10K: 40,
  TIER_100K: 80,
  TIER_UNLIMITED: 80,
  TIER_UNKNOWN: 5,
};

export interface LimitadorRitmo {
  /** Espera hasta que sea seguro enviar por este número. */
  adquirir(phoneNumberId: string, nivel: MessagingTier): Promise<void>;
}

type Cubo = { fichas: number; ultimoMs: number; mps: number };

export type OpcionesLimitador = {
  now?: () => number;
  /** Inyectable para que los tests no esperen de verdad. */
  dormir?: (ms: number) => Promise<void>;
};

export function crearLimitadorRitmo(opciones: OpcionesLimitador = {}): LimitadorRitmo {
  const now = opciones.now ?? (() => Date.now());
  const dormir = opciones.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cubos = new Map<string, Cubo>();

  return {
    async adquirir(phoneNumberId, nivel) {
      const mps = MPS_POR_NIVEL[nivel] ?? MPS_POR_NIVEL.TIER_UNKNOWN;
      const ahora = now();
      let cubo = cubos.get(phoneNumberId);
      if (!cubo || cubo.mps !== mps) {
        cubo = { fichas: mps, ultimoMs: ahora, mps };
        cubos.set(phoneNumberId, cubo);
      }
      // Rellenado continuo: fichas proporcionales al tiempo transcurrido.
      const transcurrido = Math.max(0, ahora - cubo.ultimoMs);
      cubo.fichas = Math.min(mps, cubo.fichas + (transcurrido * mps) / 1000);
      cubo.ultimoMs = ahora;

      if (cubo.fichas >= 1) {
        cubo.fichas -= 1;
        return;
      }
      const esperaMs = Math.ceil(((1 - cubo.fichas) * 1000) / mps);
      await dormir(esperaMs);
      cubo.fichas = 0;
      cubo.ultimoMs = now();
    },
  };
}
