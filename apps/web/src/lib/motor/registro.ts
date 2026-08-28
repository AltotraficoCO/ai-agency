/**
 * Registro de canales y tipos de agente.
 *
 * Los registros de `@strappy/core` son mapas de proceso: se llenan una vez al
 * arrancar. Next recarga los módulos en desarrollo, así que registrar dos veces
 * el mismo canal lanzaría; por eso todo pasa por una comprobación previa en vez
 * de por un `try/catch` que se traga errores de verdad.
 */
import { z } from "zod";
import {
  createSimulatorChannel,
  getAgentType,
  listChannels,
  registerAgentType,
  registerChannel,
  type SimulatorChannel,
} from "@strappy/core";

export const CANAL_SIMULADOR = "simulador";

const especificacion = z
  .object({
    identidad: z.object({
      nombre: z.string(),
      idioma: z.string(),
      tono: z.string(),
      proposito: z.string(),
    }),
    hace: z.array(z.string()).default([]),
    noHace: z.array(z.string()).default([]),
    recoger: z
      .array(
        z.object({
          clave: z.string(),
          etiqueta: z.string(),
          pista: z.string().optional(),
          obligatorio: z.boolean().optional(),
        }),
      )
      .default([]),
    escalar: z.array(z.string()).default([]),
  })
  .loose();

let listo = false;

export function asegurarRegistros(): void {
  if (listo) return;

  if (!listChannels().some((c) => c.slug === CANAL_SIMULADOR)) {
    registerChannel(simulador());
  }

  registrarTipo({
    slug: "conversational",
    label: "Conversacional",
    description: "Atiende a una persona en un canal de mensajería, en segundos.",
    runtime: "conversational",
    specSchema: especificacion,
    // Las seis herramientas de sistema y las que el cliente defina por HTTP.
    allowedToolPatterns: ["buscar_conocimiento", "guardar_dato_contacto", "etiquetar", "escalar_a_humano", "cerrar_conversacion", "agendar", "http_*"],
    channels: [CANAL_SIMULADOR, "whatsapp", "webchat"],
    maxToolSteps: 6,
    timeoutMs: 60_000,
    requiresApprovalForSensitive: false,
  });

  registrarTipo({
    slug: "task",
    label: "Por encargo",
    description: "Trabaja para la empresa durante minutos, con evidencia y aprobación.",
    runtime: "task",
    specSchema: especificacion,
    allowedToolPatterns: ["buscar_conocimiento", "escalar_a_humano", "http_*"],
    channels: [],
    maxToolSteps: 20,
    timeoutMs: 600_000,
    requiresApprovalForSensitive: true,
  });

  listo = true;
}

function registrarTipo(def: Parameters<typeof registerAgentType>[0]): void {
  try {
    getAgentType(def.slug);
  } catch {
    registerAgentType(def);
  }
}

/**
 * Canal simulador del proceso.
 *
 * Es un canal de pleno derecho, no un modo de prueba: el motor lo usa sin una
 * sola rama especial. Su transporte es un callback y aquí no hay ninguno,
 * porque el mensaje saliente ya queda persistido por la cola; la interfaz lo
 * lee de la base, no del canal.
 */
let instancia: SimulatorChannel | null = null;

export function simulador(): SimulatorChannel {
  instancia ??= createSimulatorChannel({ slug: CANAL_SIMULADOR, label: "Simulador" });
  return instancia;
}
