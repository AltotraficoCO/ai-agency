import "server-only";

/**
 * El turno de Strap.
 *
 * Dos decisiones sostienen este archivo:
 *
 *  1. **El prompt se recompila en CADA paso** (`prepareStep`). El borrador
 *     cambia dentro del propio turno —`draft_actualizar` escribe y la fase
 *     avanza—, así que un prompt fijado al principio le estaría contando al
 *     modelo un estado que ya no existe, y volvería a preguntar lo que acaba de
 *     guardar. Recompilar es barato: es concatenar texto.
 *
 *  2. **`preguntar` corta el turno** (`stopWhen`). Sin eso el modelo llamaría a
 *     la herramienta y seguiría hablando por encima de sus propias opciones.
 *
 * Sin clave de cartera entra `ModeloConstructorDeEnsayo`, que recorre el mismo
 * guion leyendo el mismo prompt. El circuito completo —borrador, publicación,
 * versión inmutable, auto-juego— funciona sin gastar un céntimo.
 */
import {
  convertToModelMessages,
  hasToolCall,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import {
  capacidadDelBorrador,
  esquemaBorradorAgente,
  huecosDeLaFase,
  preguntasPendientes,
  resolveModel,
  siguienteFase,
  type FaseMeta,
  type ModelTable,
} from "@strappy/core";
import { toAiToolSet, type ToolContext } from "@strappy/tools";
import { cargarTablaDeModelos } from "@strappy/db/adapters";
import { conEspacio } from "../db/pool";
import { asegurarRegistros } from "../motor/registro";
import { hayModeloReal, resolveLanguageModel } from "../motor/modelo";
import type { UsuarioActual } from "../identidad";
import { actualizarHilo, leerContextoEmpresa, leerHilo, type Hilo } from "./borradores";
import { crearHerramientasDeStrap, PERMISOS_STRAP } from "./herramientas";
import { ModeloConstructorDeEnsayo } from "./modelo-ensayo";
import { construirPromptDeStrap } from "./prompt";
import { respuestasAParcial, type RespuestaElegida } from "./respuestas";
import type { ModoConstruccion } from "./tipos";

/** Tope de pasos por turno. Ocho cubre leer, guardar, construir y publicar. */
export const PASOS_POR_TURNO = 8;

export type EntradaTurno = {
  readonly usuario: UsuarioActual;
  readonly hiloId: string;
  readonly modo: ModoConstruccion;
  readonly mensajes: readonly UIMessage[];
  /** Lo que la persona eligió en los botones. Se aplica antes que nada. */
  readonly respuestas?: readonly RespuestaElegida[];
};

export async function responderTurnoDeStrap(entrada: EntradaTurno): Promise<Response> {
  asegurarRegistros();

  const workspaceId = entrada.usuario.workspaceId;
  const empresa = await leerContextoEmpresa(workspaceId);

  // 1 · Las respuestas cerradas entran al borrador sin pasar por el modelo.
  if (entrada.respuestas && entrada.respuestas.length > 0) {
    const parcial = respuestasAParcial(entrada.respuestas);
    if (Object.keys(parcial).length > 0) {
      await actualizarHilo(workspaceId, entrada.hiloId, { borrador: parcial });
    }
  }

  // 2 · Con el borrador ya al día se decide si la fase puede avanzar.
  const hilo = await avanzarSiNoQuedaNada(workspaceId, entrada.hiloId, empresa.rutasConocidas);

  const modelTable = await conEspacio(workspaceId, (scope) => cargarTablaDeModelos(scope));
  const herramientas = crearHerramientasDeStrap({
    workspaceId,
    usuarioId: entrada.usuario.id,
    hiloId: entrada.hiloId,
    modo: entrada.modo,
    modelTable,
    empresa,
  });

  const contexto: ToolContext = {
    workspaceId,
    dryRun: false,
    scopes: [...PERMISOS_STRAP],
    ports: {},
    now: () => new Date(),
  };

  const modelo = modeloConstructor(modelTable, entrada.modo);
  const mensajes = [...entrada.mensajes];

  const resultado = streamText({
    model: modelo,
    system: promptDe(hilo, entrada, empresa),
    messages: await convertToModelMessages(mensajes),
    tools: toAiToolSet(herramientas),
    experimental_context: contexto,
    // Cortar en `preguntar` es lo que convierte una herramienta en una pausa.
    stopWhen: [stepCountIs(PASOS_POR_TURNO), hasToolCall("preguntar")],
    async prepareStep() {
      const fresco = await avanzarSiNoQuedaNada(
        workspaceId,
        entrada.hiloId,
        empresa.rutasConocidas,
      );
      return { system: promptDe(fresco, entrada, empresa) };
    },
    onError({ error }) {
      console.error("[strap] el turno falló", error);
    },
  });

  return resultado.toUIMessageStreamResponse<UIMessage>({
    originalMessages: mensajes,
    async onFinish({ messages }) {
      // El historial se guarda para que la pantalla no vuelva en blanco. El
      // ESTADO no vive aquí: vive en el borrador.
      await actualizarHilo(workspaceId, entrada.hiloId, { mensajes: messages }).catch(
        (error: unknown) => {
          console.error("[strap] no se pudo guardar el historial", error);
        },
      );
    },
    // El mensaje del error VIAJA al modelo: es lo que lee cuando una
    // herramienta rechaza su llamada. Cambiarlo por un «algo salió mal»
    // genérico convierte un error corregible en un turno perdido.
    onError(error) {
      console.error("[strap] error en el stream", error);
      return error instanceof Error
        ? error.message
        : "Se me cruzaron los cables. Vuelve a intentarlo y seguimos donde íbamos.";
    },
  });
}

function promptDe(
  hilo: Hilo,
  entrada: EntradaTurno,
  empresa: { datos: Readonly<Record<string, string>>; rutasConocidas: readonly string[] },
): string {
  const capacidad = capacidadDelBorrador(hilo.capacidad);
  const borrador = esquemaBorradorAgente.parse(hilo.borrador);
  const fase = capacidad.phases.find((f) => f.slug === hilo.fase);

  return construirPromptDeStrap({
    nombreUsuario: entrada.usuario.nombre,
    nombreEspacio: entrada.usuario.workspaceNombre,
    fase: hilo.fase,
    objetivoFase: fase?.goal ?? "avanzar el guion",
    borrador: borrador as unknown as Record<string, unknown>,
    empresa: empresa.datos,
    pendientes: preguntasPendientes({
      capacidad,
      fase: hilo.fase,
      borrador: borrador as unknown as Record<string, unknown>,
      yaSabido: empresa.rutasConocidas,
    }),
    hayAgentePublicado: hilo.agenteId !== null,
    escenarios: capacidad.verify.kind === "simulator" ? capacidad.verify.scenarios : [],
    modeloDeEnsayo: !hayModeloReal(),
  });
}

/**
 * Avanza la fase cuando la actual ya no tiene huecos.
 *
 * Lo decide el código, no el modelo: si un modelo económico decide un martes
 * que ya toca publicar, publica. Aquí solo se avanza cuando de verdad no queda
 * nada que preguntar, y solo mientras haya preguntas de por medio: de
 * `confirmacion` en adelante manda el modelo, porque lo que falta ya no son
 * datos sino decisiones de la persona.
 */
async function avanzarSiNoQuedaNada(
  workspaceId: string,
  hiloId: string,
  rutasConocidas: readonly string[],
): Promise<Hilo> {
  const hilo = await leerHilo(workspaceId, hiloId);
  if (!hilo) throw new Error("Ese hilo no existe en este espacio de trabajo.");

  const CON_PREGUNTAS: readonly FaseMeta[] = ["intencion", "recoleccion_1", "recoleccion_2"];
  if (!CON_PREGUNTAS.includes(hilo.fase)) return hilo;

  const huecos = huecosDeLaFase({
    capacidad: capacidadDelBorrador(hilo.capacidad),
    fase: hilo.fase,
    borrador: hilo.borrador,
    yaSabido: rutasConocidas,
  });
  if (huecos.length > 0) return hilo;

  return actualizarHilo(workspaceId, hiloId, { fase: siguienteFase(hilo.fase) });
}

/**
 * El modelo que construye.
 *
 * La tarea es `builder` y el modo lo elige la persona: eso es todo lo que se
 * decide fuera. Qué modelo concreto responde vive en `model_tiers`, nunca aquí.
 */
function modeloConstructor(modelTable: ModelTable, modo: ModoConstruccion): LanguageModel {
  const eleccion = resolveModel(modelTable, { mode: modo, task: "builder" });
  if (!hayModeloReal()) return new ModeloConstructorDeEnsayo(eleccion.primary);
  return resolveLanguageModel(eleccion.primary);
}
