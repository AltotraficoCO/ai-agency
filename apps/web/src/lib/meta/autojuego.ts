import "server-only";

/**
 * El auto-juego.
 *
 * Es lo que nos separa de la competencia. Al terminar de construir un agente,
 * nadie quiere «probarlo»: quiere VERLO funcionar. Así que en vez de dejar un
 * cuadro de texto vacío, ponemos a un modelo a hacer de cliente —con un guion
 * concreto: «cliente interesado con presupuesto bajo»— y lo enfrentamos al
 * agente recién publicado durante cuatro a seis turnos.
 *
 * El agente NO se ejecuta de mentira: se le habla por el canal simulador y
 * responde con el mismo motor, el mismo prompt compilado y las mismas
 * herramientas que va a usar con un cliente real. Lo único simulado es el
 * cliente.
 *
 * Y no se enseña solo el transcript: se enseña lo que el agente CONSIGUIÓ
 * averiguar. Un agente que conversa bonito y no recoge el teléfono no sirve.
 */
import { generateText } from "ai";
import { resolveModel, withModelFallback, type ModelTable } from "@strappy/core";
import { resolveLanguageModel } from "../motor/modelo";
import { asegurarSesion, enviarMensaje, reiniciarSesion } from "../motor/simulador";
import type { SalidaAutojuego, TurnoAutojuego } from "./tipos";

export const TURNOS_MINIMOS = 4;
export const TURNOS_MAXIMOS = 6;

export type EntradaAutojuego = {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly guion: string;
  readonly modo: "lite" | "max";
  readonly modelTable: ModelTable;
  readonly nombreAgente: string;
  readonly recoger: readonly { clave: string; etiqueta: string }[];
  readonly turnos?: number;
};

export async function jugarSolo(entrada: EntradaAutojuego): Promise<SalidaAutojuego> {
  const cuantos = Math.min(
    TURNOS_MAXIMOS,
    Math.max(TURNOS_MINIMOS, entrada.turnos ?? TURNOS_MINIMOS + 1),
  );

  const conversationId = await asegurarSesion({
    workspaceId: entrada.workspaceId,
    agentId: entrada.agentId,
  });
  // Cada prueba empieza limpia: un transcript que arrastra la prueba anterior
  // no demuestra nada y confunde a quien lo lee.
  await reiniciarSesion({ workspaceId: entrada.workspaceId, conversationId });

  const turnos: TurnoAutojuego[] = [];
  let aviso: string | undefined;

  for (let i = 0; i < cuantos; i++) {
    const mensajeCliente = await hablarComoCliente(entrada, turnos, i === 0);
    turnos.push({ quien: "cliente", texto: mensajeCliente });

    const resultado = await enviarMensaje({
      workspaceId: entrada.workspaceId,
      agentId: entrada.agentId,
      conversationId,
      texto: mensajeCliente,
    });

    if (resultado.estado !== "replied" || !resultado.respuesta) {
      aviso = resultado.motivo ?? "El agente no respondió en este turno.";
      break;
    }
    turnos.push({ quien: "agente", texto: resultado.respuesta });
  }

  const variables = await extraerVariables(entrada, turnos);

  return {
    tipo: "autojuego",
    guion: entrada.guion,
    turnos,
    variables,
    ...(aviso ? { aviso } : {}),
  };
}

/**
 * El cliente falso.
 *
 * Se le dan los turnos con los papeles invertidos —lo que dijo el agente le
 * llega como `user`— porque para él el agente es su interlocutor. Suena obvio
 * y es justo donde se equivoca un auto-juego mal montado: si se le pasan los
 * roles tal cual, el modelo cree que ya habló él y se contesta a sí mismo.
 */
async function hablarComoCliente(
  entrada: EntradaAutojuego,
  turnos: readonly TurnoAutojuego[],
  primero: boolean,
): Promise<string> {
  const eleccion = resolveModel(entrada.modelTable, {
    mode: entrada.modo,
    task: "conversation",
  });

  const sistema = [
    `Eres una persona real escribiendo por WhatsApp a un negocio. NO eres un asistente.`,
    `Tu situación: ${entrada.guion}.`,
    ``,
    `Escribe como escribe la gente por chat: una o dos frases, sin saludos largos,`,
    `sin listas y sin Markdown. Si te preguntan un dato tuyo, invéntatelo y dilo`,
    `con naturalidad. No digas nunca que eres una prueba ni una simulación.`,
    primero
      ? `Escribe el PRIMER mensaje: por qué escribes al negocio.`
      : `Responde a lo último que te dijeron y sigue avanzando hacia lo que quieres.`,
  ].join("\n");

  const mensajes = turnos.map((t) => ({
    role: (t.quien === "agente" ? "user" : "assistant") as "user" | "assistant",
    content: t.texto,
  }));

  try {
    const { text } = await withModelFallback(eleccion, (modelId) =>
      generateText({
        model: resolveLanguageModel(modelId),
        system: sistema,
        messages:
          mensajes.length > 0
            ? mensajes
            : [{ role: "user" as const, content: "Escribe tu primer mensaje." }],
        maxOutputTokens: 200,
      }),
    );
    const limpio = text.trim();
    if (limpio.length > 0) return recortar(limpio, 400);
  } catch {
    // Un fallo del modelo del cliente no puede tumbar la prueba entera.
  }
  return primero
    ? "Hola, quería preguntar por lo que ofrecen."
    : "Vale, ¿y qué me recomiendas entonces?";
}

/**
 * Qué averiguó el agente.
 *
 * Se le pide al modelo y, si no devuelve JSON legible —pasa con los modelos
 * económicos y pasa siempre con el modelo de ensayo local—, se cae a una
 * lectura literal del transcript. Preferimos una extracción pobre y honesta a
 * una tabla vacía que hace pensar que el agente no recogió nada.
 */
async function extraerVariables(
  entrada: EntradaAutojuego,
  turnos: readonly TurnoAutojuego[],
): Promise<SalidaAutojuego["variables"]> {
  if (entrada.recoger.length === 0 || turnos.length === 0) return [];

  const transcript = turnos
    .map((t) => `${t.quien === "cliente" ? "Cliente" : entrada.nombreAgente}: ${t.texto}`)
    .join("\n");

  const delModelo = await intentarExtraccionConModelo(entrada, transcript);
  const heuristica = extraerAOjo(turnos);

  return entrada.recoger
    .map((campo) => {
      const valor = (delModelo[campo.clave] ?? heuristica[campo.clave] ?? "").trim();
      return { clave: campo.clave, etiqueta: campo.etiqueta, valor };
    })
    .filter((v) => v.valor.length > 0);
}

async function intentarExtraccionConModelo(
  entrada: EntradaAutojuego,
  transcript: string,
): Promise<Record<string, string>> {
  try {
    const eleccion = resolveModel(entrada.modelTable, { mode: entrada.modo, task: "extraction" });
    const claves = entrada.recoger.map((c) => `"${c.clave}"`).join(", ");
    const { text } = await withModelFallback(eleccion, (modelId) =>
      generateText({
        model: resolveLanguageModel(modelId),
        system:
          `Extrae datos de una conversación. Responde SOLO con un objeto JSON con estas claves: ${claves}. ` +
          `Si un dato no aparece, deja la cadena vacía. Sin explicaciones, sin bloques de código.`,
        prompt: transcript,
        maxOutputTokens: 300,
      }),
    );
    const crudo = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const objeto: unknown = JSON.parse(crudo);
    if (objeto === null || typeof objeto !== "object") return {};
    const salida: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(objeto as Record<string, unknown>)) {
      if (typeof valor === "string") salida[clave] = valor;
      else if (typeof valor === "number") salida[clave] = String(valor);
    }
    return salida;
  } catch {
    return {};
  }
}

const PATRONES: Readonly<Record<string, RegExp>> = {
  telefono: /(\+?\d[\d ().-]{6,}\d)/,
  correo: /([\w.+-]+@[\w-]+\.[\w.]{2,})/,
};

/** Lectura literal: solo lo que se puede reconocer sin interpretar. */
function extraerAOjo(turnos: readonly TurnoAutojuego[]): Record<string, string> {
  const delCliente = turnos
    .filter((t) => t.quien === "cliente")
    .map((t) => t.texto)
    .join("\n");
  const salida: Record<string, string> = {};
  for (const [clave, patron] of Object.entries(PATRONES)) {
    const encontrado = patron.exec(delCliente);
    if (encontrado?.[1]) salida[clave] = encontrado[1].trim();
  }
  return salida;
}

function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}
