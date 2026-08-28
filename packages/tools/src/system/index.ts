/**
 * Herramientas de sistema de la v1.
 *
 * Seis. Ni una más hasta que un cliente real la pida: cada herramienta que el
 * modelo ve es una decisión más que puede tomar mal.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "../registry.js";
import { requirePort } from "../ports.js";

export const buscarConocimiento = defineTool({
  slug: "buscar_conocimiento",
  label: "Buscar en el conocimiento",
  description:
    "Busca en los documentos, catálogos y respuestas frecuentes que la empresa cargó.",
  whenToUse:
    "siempre que la persona pregunte algo sobre la empresa, sus productos, precios, horarios o políticas, antes de responder",
  inputSchema: z.object({
    consulta: z
      .string()
      .min(2)
      .max(400)
      .describe("Lo que hay que buscar, con las palabras de la persona."),
    limite: z.number().int().min(1).max(8).default(4).describe("Cuántos fragmentos traer."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: ["knowledge:read"],
  effect: "read",
  kind: "system",
  async execute(ctx, input) {
    const knowledge = requirePort(ctx.ports, "knowledge", "buscar_conocimiento");
    const hits = await knowledge.search({
      workspaceId: ctx.workspaceId,
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
      query: input.consulta,
      limit: input.limite,
    });
    return {
      encontrados: hits.length,
      fragmentos: hits.map((h) => ({ titulo: h.title, texto: h.text, fuente: h.source })),
    };
  },
});

export const guardarDatoContacto = defineTool({
  slug: "guardar_dato_contacto",
  label: "Guardar un dato del contacto",
  description: "Guarda un dato que la persona acaba de dar (nombre, correo, ciudad, presupuesto…).",
  whenToUse:
    "en cuanto la persona diga un dato que la empresa quería averiguar, sin anunciarlo ni repetirlo",
  inputSchema: z.object({
    clave: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, "Usa minúsculas y guion bajo, p.ej. correo_electronico.")
      .describe("Nombre del dato tal como lo pidió la empresa."),
    valor: z.string().min(1).max(500).describe("El valor, tal como lo dijo la persona."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: ["contacts:write"],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const contacts = requirePort(ctx.ports, "contacts", "guardar_dato_contacto");
    if (!ctx.conversationId) throw new Error("guardar_dato_contacto necesita una conversación activa.");
    await contacts.saveField({
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      ...(ctx.contactId ? { contactId: ctx.contactId } : {}),
      key: input.clave,
      value: input.valor,
    });
    return { guardado: true, clave: input.clave };
  },
});

export const etiquetar = defineTool({
  slug: "etiquetar",
  label: "Etiquetar la conversación",
  description: "Pone etiquetas a la conversación para clasificarla en la bandeja.",
  whenToUse: "cuando quede claro de qué trata la conversación o cómo terminó",
  inputSchema: z.object({
    etiquetas: z
      .array(z.string().min(1).max(40))
      .min(1)
      .max(5)
      .describe("Entre una y cinco etiquetas cortas."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: ["contacts:write"],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const contacts = requirePort(ctx.ports, "contacts", "etiquetar");
    if (!ctx.conversationId) throw new Error("etiquetar necesita una conversación activa.");
    await contacts.addTags({
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      ...(ctx.contactId ? { contactId: ctx.contactId } : {}),
      tags: input.etiquetas,
    });
    return { etiquetado: true, etiquetas: input.etiquetas };
  },
});

export const escalarAHumano = defineTool({
  slug: "escalar_a_humano",
  label: "Pasar con una persona",
  description:
    "Pasa la conversación a una persona del equipo y deja de responder automáticamente.",
  whenToUse:
    "cuando la persona lo pida, cuando esté molesta, o cuando lo que necesita se salga de lo que puedes resolver",
  inputSchema: z.object({
    motivo: z.string().min(3).max(300).describe("Por qué hace falta una persona."),
    urgencia: z.enum(["normal", "alta"]).default("normal"),
    resumen: z
      .string()
      .max(600)
      .optional()
      .describe("Qué necesita la persona, para que el equipo no tenga que releer todo."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: ["handover:write"],
  // Notifica a personas de verdad: en el simulador no debe sonar el teléfono de nadie.
  effect: "write_external",
  kind: "system",
  async execute(ctx, input) {
    const handover = requirePort(ctx.ports, "handover", "escalar_a_humano");
    if (!ctx.conversationId) throw new Error("escalar_a_humano necesita una conversación activa.");
    const res = await handover.escalate({
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      reason: input.motivo,
      urgency: input.urgencia,
      ...(input.resumen ? { summary: input.resumen } : {}),
    });
    return { escalado: true, notificado: res.notified, cola: res.queue };
  },
  simulate(_ctx, input) {
    return {
      escalado: true,
      notificado: false,
      cola: "simulacion",
      simulado: true,
      nota: `En una conversación real, el equipo recibiría este aviso: ${input.motivo}`,
    };
  },
});

export const cerrarConversacion = defineTool({
  slug: "cerrar_conversacion",
  label: "Cerrar la conversación",
  description: "Marca la conversación como resuelta.",
  whenToUse: "cuando el asunto quedó resuelto y la persona se despidió",
  inputSchema: z.object({
    resultado: z
      .enum(["resuelto", "sin_interes", "duplicado", "spam", "sin_respuesta"])
      .describe("Cómo terminó."),
    nota: z.string().max(300).optional(),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: ["handover:write"],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const handover = requirePort(ctx.ports, "handover", "cerrar_conversacion");
    if (!ctx.conversationId) throw new Error("cerrar_conversacion necesita una conversación activa.");
    await handover.close({
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      outcome: input.resultado,
      ...(input.nota ? { note: input.nota } : {}),
    });
    return { cerrado: true, resultado: input.resultado };
  },
});

export const agendar = defineTool({
  slug: "agendar",
  label: "Agendar una cita",
  description:
    "Consulta huecos disponibles y reserva una cita en la agenda de la empresa.",
  whenToUse: "cuando la persona quiera una cita, demo o visita y ya sepas cuándo le sirve",
  inputSchema: z.object({
    accion: z
      .enum(["consultar", "reservar"])
      .describe("Primero 'consultar' para ver huecos, luego 'reservar' con uno de ellos."),
    desde: z.string().datetime().optional().describe("Inicio del rango a consultar, en ISO 8601."),
    hasta: z.string().datetime().optional().describe("Fin del rango a consultar, en ISO 8601."),
    inicio: z.string().datetime().optional().describe("Hueco elegido al reservar, en ISO 8601."),
    duracion_minutos: z.number().int().min(15).max(240).default(30),
    titulo: z.string().max(120).optional(),
    nombre: z.string().max(120).optional(),
    correo: z.email().optional(),
    notas: z.string().max(400).optional(),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: ["scheduling:write"],
  effect: "write_external",
  kind: "system",
  async execute(ctx, input) {
    const scheduling = requirePort(ctx.ports, "scheduling", "agendar");
    if (input.accion === "consultar") {
      const ahora = ctx.now();
      const desde = input.desde ?? ahora.toISOString();
      const hasta = input.hasta ?? new Date(ahora.getTime() + 7 * 24 * 3600 * 1000).toISOString();
      const slots = await scheduling.availability({
        workspaceId: ctx.workspaceId,
        fromISO: desde,
        toISO: hasta,
        durationMinutes: input.duracion_minutos,
      });
      return {
        accion: "consultar" as const,
        huecos: slots.slice(0, 6).map((s) => ({ inicio: s.startsAt, fin: s.endsAt, etiqueta: s.label })),
      };
    }
    if (!input.inicio) throw new Error("Para reservar hace falta 'inicio' con un hueco consultado.");
    if (!ctx.conversationId) throw new Error("agendar necesita una conversación activa.");
    const evento = await scheduling.book({
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      startsAtISO: input.inicio,
      durationMinutes: input.duracion_minutos,
      title: input.titulo ?? "Cita",
      ...(input.nombre ? { attendeeName: input.nombre } : {}),
      ...(input.correo ? { attendeeEmail: input.correo } : {}),
      ...(input.notas ? { notes: input.notas } : {}),
    });
    return { accion: "reservar" as const, agendado: true, eventoId: evento.eventId, inicio: evento.startsAtISO, enlace: evento.joinUrl };
  },
  simulate(ctx, input) {
    if (input.accion === "consultar") {
      // Huecos plausibles: mañana y pasado a media mañana, en horario laboral.
      const base = ctx.now();
      const huecos = [1, 2, 3].map((d) => {
        const inicio = new Date(base.getTime() + d * 24 * 3600 * 1000);
        inicio.setUTCHours(15, 0, 0, 0);
        const fin = new Date(inicio.getTime() + input.duracion_minutos * 60 * 1000);
        return { inicio: inicio.toISOString(), fin: fin.toISOString(), etiqueta: undefined };
      });
      return { accion: "consultar" as const, huecos, simulado: true, nota: "Huecos de ejemplo del simulador." };
    }
    return {
      accion: "reservar" as const,
      agendado: true,
      eventoId: "sim_evento_1",
      inicio: input.inicio ?? ctx.now().toISOString(),
      enlace: undefined,
      simulado: true,
      nota: "En una conversación real esto crearía la cita en la agenda de la empresa.",
    };
  },
});

export const SYSTEM_TOOLS = [
  agendar,
  buscarConocimiento,
  cerrarConversacion,
  escalarAHumano,
  etiquetar,
  guardarDatoContacto,
] as unknown as readonly ToolDef<never, unknown>[];
