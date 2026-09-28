/**
 * Con quién puede contar un agente y cómo se le encarga trabajo a un compañero.
 *
 * El compañero se ejecuta con SU contexto y SUS aprobaciones: aquí solo se
 * enruta. Comparte el `taskId` a propósito, para que el cliente vea un único
 * encargo con todo lo que pasó dentro, y sus créditos se suman al mismo cargo.
 */
import type {
  ColaboracionPort,
  Companero,
  EncargoDelegado,
  ResultadoTarea,
} from "@strappy/agentes";
import type { NominaPort, TareaReclamada } from "../../ports.js";
import type { Encargo } from "./encargo.js";

/** Cómo se ejecuta un oficio: el enrutado del consumidor, que es recursivo. */
export type EjecutarAgente = (quien: string, e: Encargo) => Promise<ResultadoTarea>;

export function puertoDeColaboracion(
  quien: string,
  e: Encargo,
  nomina: NominaPort,
  ejecutarAgente: EjecutarAgente,
): ColaboracionPort {
  return {
    companeros: () => nomina.companeros({ workspaceId: e.tarea.workspaceId, exceptoSlug: quien }),
    encargar: async (input: EncargoDelegado): Promise<ResultadoTarea> => {
      e.decir(`${quien} le pide ayuda a ${input.slug}: "${input.titulo}"`);
      // La petición y la respuesta se anotan como pasos del encargo, con
      // quién habla en cada uno: el cliente ve la conversación entre los
      // dos, no una lista de pasos sueltos sin dueño.
      const [nombreQuien, nombreCompanero] = await Promise.all([
        nombreDe(nomina, e.tarea.workspaceId, quien),
        nombreDe(nomina, e.tarea.workspaceId, input.slug),
      ]);
      const marca = Date.now();
      e.registro.anotar({
        id: `colaboracion-${marca}-pide`,
        herramienta: "colaboracion",
        etiqueta: `Le pide ayuda a ${nombreCompanero}`,
        detalle: input.titulo,
        estado: "hecho",
        en: new Date().toISOString(),
        agente: { slug: quien, nombre: nombreQuien },
      });
      // El compañero empieza de cero: el historial y las aprobaciones son de
      // quien llamó. Pasárselos hacía que el Webmaster «continuara» la
      // conversación del Velocista y respondiera como si fuera él.
      //
      // La excepción es retomarlo: si este mismo compañero dejó una parte a
      // un clic en el intento anterior, vuelve con SU conversación y con las
      // decisiones que el cliente acaba de dar. Esas decisiones son suyas y
      // no de quien llamó: sus huellas apuntan a las herramientas del
      // compañero, así que inyectarlas arriba no valdría de nada.
      const retomar = colaboracionAMedias(e.tarea, input.slug);
      const resultado = await ejecutarAgente(input.slug, {
        ...e,
        tarea: retomar
          ? { ...e.tarea, mensajes: retomar.mensajes, ...(e.tarea.aprobaciones ? { aprobaciones: e.tarea.aprobaciones } : {}) }
          : { ...e.tarea, mensajes: undefined, aprobaciones: undefined },
        cadena: [...e.cadena, quien],
        delegado: { titulo: input.titulo, detalle: input.detalle },
      });
      e.decir(
        `${input.slug} terminó (${resultado.estado}) · ${resultado.evidencia.creditos} créditos`,
      );

      if (resultado.estado === "esperando_aprobacion") {
        // El clic se pide en ESTE encargo, que es donde está el cliente
        // mirando. Se guarda por dónde iba el compañero para retomarlo, y
        // sus créditos se suman aquí porque su trabajo ya no vive aparte.
        e.extra.creditos += resultado.evidencia.creditos;
        e.extra.colaboracionPendiente = {
          slug: input.slug,
          titulo: input.titulo,
          detalle: input.detalle,
          mensajes: resultado.mensajes,
        };
        e.registro.anotar({
          id: `colaboracion-${marca}-responde`,
          herramienta: "colaboracion",
          etiqueta: `Necesita tu aprobación para terminar`,
          detalle: resultado.resumen,
          estado: "esperando",
          en: new Date().toISOString(),
          agente: { slug: input.slug, nombre: nombreCompanero },
        });
        e.decir(
          `${input.slug} espera ${resultado.evidencia.aprobacionesPendientes.length} aprobaciones en este mismo encargo`,
        );
        return resultado;
      }

      e.extra.creditos += resultado.evidencia.creditos;
      e.registro.anotar({
        id: `colaboracion-${marca}-responde`,
        herramienta: "colaboracion",
        etiqueta:
          resultado.estado === "completada" ? `Le responde a ${nombreQuien}` : `No pudo terminar lo que pidió ${nombreQuien}`,
        detalle:
          resultado.estado === "fallida" ? resultado.error : resultado.resumen,
        estado: resultado.estado === "completada" ? "hecho" : "error",
        en: new Date().toISOString(),
        agente: { slug: input.slug, nombre: nombreCompanero },
      });
      return resultado;
    },
  };
}

/** ¿Lo que dejó esperando este encargo fue la parte de un compañero? */
export function esperaDeUnCompanero(tarea: TareaReclamada): boolean {
  const ev = tarea.evidencia as { colaboracionPendiente?: unknown } | null | undefined;
  return Boolean(ev?.colaboracionPendiente);
}

/**
 * La colaboración que quedó a un clic en el intento anterior, si es de este
 * mismo compañero.
 *
 * Vive en la evidencia del encargo suspendido. Se compara el slug a
 * propósito: si el agente decide pedirle ayuda a OTRO compañero al
 * reanudarse, ese empieza de cero, que es lo correcto.
 */
function colaboracionAMedias(
  tarea: TareaReclamada,
  slug: string,
): { mensajes: readonly unknown[] } | null {
  const ev = tarea.evidencia as
    | { colaboracionPendiente?: { slug?: unknown; mensajes?: unknown } }
    | null
    | undefined;
  const p = ev?.colaboracionPendiente;
  if (!p || p.slug !== slug || !Array.isArray(p.mensajes) || p.mensajes.length === 0) return null;
  return { mensajes: p.mensajes };
}

/** Cómo se llama en este espacio el agente de un oficio; el slug si no se sabe. */
export async function nombreDe(
  nomina: NominaPort | undefined,
  workspaceId: string,
  slug: string,
): Promise<string> {
  if (!nomina) return slug;
  try {
    const companeros = await nomina.companeros({ workspaceId, exceptoSlug: "" });
    return companeros.find((c) => c.slug === slug)?.nombre ?? slug;
  } catch {
    return slug;
  }
}

/** La nómina, ya resuelta, para ofrecérsela al modelo en su prompt. */
export async function companerosDe(
  nomina: NominaPort | undefined,
  quien: string,
  workspaceId: string,
): Promise<readonly Companero[]> {
  if (!nomina) return [];
  try {
    return await nomina.companeros({ workspaceId, exceptoSlug: quien });
  } catch {
    // Quedarse sin compañeros es trabajar solo, que es lo de siempre. No es
    // motivo para tumbar un encargo que el cliente ya aprobó.
    return [];
  }
}
