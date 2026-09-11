/**
 * Strap sin clave de modelo.
 *
 * El `ModeloDeEnsayo` de `lib/motor/modelo.ts` no sabe hacer streaming ni
 * llamar herramientas —el motor de conversación usa `generateText` y no lo
 * necesita—, pero el meta-agente sí: su interfaz entera se pinta desde partes
 * de herramienta en streaming.
 *
 * Así que aquí hay un segundo modelo de ensayo, este sí conversacional, que no
 * intenta razonar: LEE el prompt de sistema —que ya trae la fase y la lista
 * exacta de lo que falta preguntar, calculadas en `@strappy/core`— y llama a la
 * herramienta que toca. Es un actor siguiendo un guion escrito por otro.
 *
 * No es un juguete: recorre el guion completo, publica un agente de verdad y
 * lo prueba de verdad. Sirve para desarrollar, para las pruebas de navegador y
 * para que una instalación recién clonada haga algo el primer día.
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { esSitioWeb } from "@strappy/core";

type PreguntaLeida = {
  clave: string;
  enunciado: string;
  opciones: { valor: string; etiqueta: string; pista?: string }[];
  abierta: boolean;
  multiple: boolean;
};

export class ModeloConstructorDeEnsayo implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "strappy-ensayo-constructor";
  readonly supportedUrls = {};

  constructor(readonly modelId: string) {}

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const plan = planificar(leerSistema(options.prompt), yaLlamadas(options.prompt));
    return {
      content: [{ type: "text", text: plan.texto }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      warnings: [avisoDeEnsayo()],
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<{ stream: ReadableStream<LanguageModelV3StreamPart> }> {
    const plan = planificar(leerSistema(options.prompt), yaLlamadas(options.prompt));
    const disponibles = new Set(
      (options.tools ?? []).map((t) => ("name" in t ? String(t.name) : "")),
    );
    const llamada =
      plan.herramienta && disponibles.has(plan.herramienta.nombre) ? plan.herramienta : null;

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [avisoDeEnsayo()] });

        const id = "t0";
        controller.enqueue({ type: "text-start", id });
        for (const trozo of trocear(plan.texto)) {
          controller.enqueue({ type: "text-delta", id, delta: trozo });
        }
        controller.enqueue({ type: "text-end", id });

        if (llamada) {
          const toolCallId = `ensayo_${Date.now().toString(36)}`;
          const input = JSON.stringify(llamada.entrada);
          controller.enqueue({
            type: "tool-input-start",
            id: toolCallId,
            toolName: llamada.nombre,
          });
          controller.enqueue({ type: "tool-input-delta", id: toolCallId, delta: input });
          controller.enqueue({ type: "tool-input-end", id: toolCallId });
          controller.enqueue({
            type: "tool-call",
            toolCallId,
            toolName: llamada.nombre,
            input,
          });
        }

        controller.enqueue({
          type: "finish",
          finishReason: llamada ? { unified: "tool-calls", raw: "tool_calls" } : { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 20, text: 20, reasoning: 0 },
          },
        });
        controller.close();
      },
    });

    return { stream };
  }
}

function avisoDeEnsayo(): { type: "other"; message: string } {
  return {
    type: "other",
    message:
      "Strap está corriendo con el constructor de ensayo local: no hay clave de la cartera de modelos configurada.",
  };
}

// ---------------------------------------------------------------------------
// Lectura del prompt de sistema
// ---------------------------------------------------------------------------

function leerSistema(prompt: LanguageModelV3Prompt): string {
  for (const mensaje of prompt) {
    if (mensaje.role !== "system") continue;
    if (typeof mensaje.content === "string") return mensaje.content;
  }
  return "";
}

/**
 * Qué se ha llamado ya en este turno.
 *
 * La firma incluye la fase para que mover el guion dos veces seguidas —de
 * `intencion` a `recoleccion_1` y luego a `recoleccion_2`— no se confunda con
 * repetirse en bucle. El tope real lo pone `stopWhen` en la ruta.
 */
function yaLlamadas(prompt: LanguageModelV3Prompt): Set<string> {
  const firmas = new Set<string>();
  for (const mensaje of prompt) {
    if (mensaje.role !== "assistant" || !Array.isArray(mensaje.content)) continue;
    for (const parte of mensaje.content) {
      if (parte.type !== "tool-call") continue;
      firmas.add(parte.toolName);
      if (parte.toolName === "draft_actualizar") {
        firmas.add(`draft_actualizar:${faseDeLaEntrada(parte.input)}`);
      }
    }
  }
  return firmas;
}

function faseDeLaEntrada(input: unknown): string {
  try {
    const valor: unknown = typeof input === "string" ? JSON.parse(input) : input;
    if (valor !== null && typeof valor === "object") {
      const fase = (valor as Record<string, unknown>)["fase"];
      if (typeof fase === "string") return fase;
    }
  } catch {
    // Una entrada ilegible cuenta como sin fase; el tope de pasos protege igual.
  }
  return "";
}

export function leerFase(sistema: string): string {
  return /^Fase: ([a-z_0-9]+)/m.exec(sistema)?.[1] ?? "intencion";
}

export function leerPendientes(sistema: string): PreguntaLeida[] {
  const preguntas: PreguntaLeida[] = [];
  for (const linea of sistema.split("\n")) {
    const cabecera = /^- `([^`]+)`: (.+)$/.exec(linea);
    if (cabecera) {
      preguntas.push({
        clave: cabecera[1]!,
        enunciado: cabecera[2]!,
        opciones: [],
        abierta: false,
        multiple: false,
      });
      continue;
    }
    const actual = preguntas[preguntas.length - 1];
    if (!actual) continue;
    const opcion = /^\s+· valor `([^`]*)` → «([^»]+)»(?: \((.+)\))?$/.exec(linea);
    if (opcion) {
      actual.opciones.push({
        valor: opcion[1] ?? "",
        etiqueta: opcion[2] ?? "",
        ...(opcion[3] ? { pista: opcion[3] } : {}),
      });
      continue;
    }
    if (/·\s*admite respuesta escrita/.test(linea)) actual.abierta = true;
    if (/·\s*admite varias respuestas/.test(linea)) actual.multiple = true;
  }
  return preguntas;
}

function leerBorrador(sistema: string): Record<string, unknown> {
  const bloque = /```json\n([\s\S]*?)\n```/.exec(sistema)?.[1];
  if (!bloque) return {};
  try {
    const valor: unknown = JSON.parse(bloque);
    return valor !== null && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// El guion
// ---------------------------------------------------------------------------

type Plan = {
  texto: string;
  herramienta: { nombre: string; entrada: Record<string, unknown> } | null;
};

function planificar(sistema: string, hechas: ReadonlySet<string>): Plan {
  const pendientes = leerPendientes(sistema);
  if (pendientes.length > 0 && !hechas.has("preguntar")) {
    return {
      texto:
        pendientes.length === 1
          ? "Una cosa más y seguimos."
          : "Perfecto. Dime esto y arranco con el montaje.",
      herramienta: {
        nombre: "preguntar",
        entrada: {
          preguntas: pendientes.slice(0, 3).map((p) => ({
            clave: p.clave,
            enunciado: p.enunciado,
            opciones: p.opciones,
            multiple: p.multiple,
            abierta: p.abierta || p.opciones.length === 0,
          })),
        },
      },
    };
  }

  const borrador = leerBorrador(sistema);
  const fase = leerFase(sistema);
  const empresa = (borrador["empresa"] ?? {}) as Record<string, unknown>;
  const agente = (borrador["agente"] ?? {}) as Record<string, unknown>;
  const nombreAgente = texto(agente["nombre"]) || "Tu agente";
  const nombreEmpresa = texto(empresa["nombre"]) || "tu negocio";
  const sitioWeb = esSitioWeb(empresa["sitioWeb"]) ? empresa["sitioWeb"] : "";
  const cerebroId = texto(borrador["cerebroId"]);
  const yaHace = Array.isArray(borrador["hace"]) && borrador["hace"].length > 0;
  const yaRecoge = Array.isArray(borrador["recoger"]) && borrador["recoger"].length > 0;

  const paso = (nombre: string, entrada: Record<string, unknown>, mensaje: string): Plan => {
    const firma =
      nombre === "draft_actualizar" ? `draft_actualizar:${texto(entrada["fase"])}` : nombre;
    return { texto: mensaje, herramienta: hechas.has(firma) ? null : { nombre, entrada } };
  };

  switch (fase) {
    case "intencion":
      return paso(
        "draft_actualizar",
        { parcial: {}, fase: "recoleccion_1", titulo: `Agente de ${nombreEmpresa}` },
        "Anotado. Vamos con tu negocio.",
      );

    case "recoleccion_1":
      if (sitioWeb && !hechas.has("analizar_sitio_web")) {
        return paso("analizar_sitio_web", { url: sitioWeb }, "Déjame leer tu sitio un momento.");
      }
      return paso(
        "draft_actualizar",
        { parcial: {}, fase: "recoleccion_2" },
        "Ya tengo el contexto del negocio.",
      );

    case "recoleccion_2":
      if (!yaRecoge) {
        return paso(
          "proponer_variables_extraccion",
          {
            variables: [
              { clave: "nombre", etiqueta: "nombre", obligatorio: true },
              { clave: "telefono", etiqueta: "teléfono", obligatorio: true },
              { clave: "interes", etiqueta: "producto de interés" },
            ],
          },
          "Estos son los datos que conviene que averigüe.",
        );
      }
      if (!yaHace) {
        return paso(
          "draft_actualizar",
          {
            parcial: {
              hace: [
                `Responde dudas sobre ${nombreEmpresa}`,
                "Toma los datos de contacto de quien escribe",
              ],
              noHace: ["No promete descuentos ni plazos que no estén confirmados"],
              escalar: ["Si la persona pide hablar con alguien del equipo"],
              objetivo: "dejar el contacto listo para que el equipo cierre",
            },
            fase: "confirmacion",
          },
          "Le pongo límites claros y lo dejo listo para revisar.",
        );
      }
      return paso(
        "draft_actualizar",
        { parcial: {}, fase: "confirmacion" },
        "Listo para revisar.",
      );

    case "confirmacion":
      if (!hechas.has("confirmar_construccion")) {
        return paso("confirmar_construccion", {}, "Esto es lo que voy a construir. Revísalo.");
      }
      return { texto: "Cuando me des el visto bueno, lo publico.", herramienta: null };

    case "construccion":
      if (sitioWeb && !cerebroId && !hechas.has("crear_brain_desde_fuentes")) {
        return paso(
          "crear_brain_desde_fuentes",
          { nombre: `Conocimiento de ${nombreEmpresa}`, urls: [sitioWeb], textos: [] },
          "Le doy de comer tu sitio web.",
        );
      }
      return paso("publicar_agente", {}, "Publicando.");

    case "reporte":
      return paso(
        "probar_agente",
        { guion: "cliente interesado con presupuesto bajo" },
        `${nombreAgente} ya está publicado. Míralo trabajar.`,
      );

    case "prueba":
      return paso("mostrar_tarjeta_agente", {}, "Se defiende bien. Aquí lo tienes.");

    default:
      return {
        texto: `${nombreAgente} está listo. ¿Conectamos WhatsApp o quieres afinarle algo?`,
        herramienta: null,
      };
  }
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** Trocea en palabras para que el texto aparezca escribiéndose, no de golpe. */
function trocear(texto: string): string[] {
  return texto.split(/(?<=\s)/);
}
