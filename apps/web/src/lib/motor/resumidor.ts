/**
 * `SummarizerPort`: el resumen rodante.
 *
 * Usa el modelo de la tarea `summary`, que es el barato a propósito: resumir no
 * es difícil, y es lo que evita que una conversación de seis meses convierta
 * cada respuesta en una factura.
 */
import { generateText } from "ai";
import { resolveModel, type ModelTable, type SummarizerPort } from "@strappy/core";
import { resolveLanguageModel } from "./modelo";

export function crearResumidor(modelTable: ModelTable, mode: "lite" | "max"): SummarizerPort {
  return {
    async summarize({ previousSummary, messages, language }) {
      const eleccion = resolveModel(modelTable, { mode, task: "summary" });
      const transcripcion = messages
        .map((m) => `${m.role === "user" ? "Cliente" : "Agente"}: ${textoDe(m.content)}`)
        .join("\n");

      const { text } = await generateText({
        model: resolveLanguageModel(eleccion.primary),
        system:
          `Resumes conversaciones de atención al cliente en ${language}. ` +
          "Conserva datos concretos (nombres, cifras, fechas, decisiones) y descarta la cortesía. " +
          "Máximo diez líneas. No inventes nada que no esté en la conversación.",
        prompt: previousSummary
          ? `Resumen anterior:\n${previousSummary}\n\nMensajes nuevos:\n${transcripcion}\n\nDevuelve el resumen actualizado.`
          : `Mensajes:\n${transcripcion}\n\nDevuelve el resumen.`,
      });
      return text.trim();
    },
  };
}

function textoDe(content: { kind: string } & Record<string, unknown>): string {
  return typeof content["text"] === "string" ? content["text"] : `[${content.kind}]`;
}
