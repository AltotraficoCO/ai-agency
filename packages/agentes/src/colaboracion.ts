/**
 * Un agente le pide ayuda a otro de la misma empresa.
 *
 * La idea de producto es una oficina, no una colección de robots sueltos: si el
 * Webmaster necesita una pieza de diseño y el cliente tiene contratado a un
 * diseñador, se la pide, igual que un empleado se gira hacia el de al lado.
 *
 * Cuatro reglas que no son de estilo, cada una por un fallo que se paga caro:
 *
 *  · **Solo se puede llamar a quien está contratado.** Si no lo está, la
 *    herramienta lo dice y el agente sigue con lo suyo: pedirle al cliente que
 *    contrate a alguien a mitad de un encargo es peor que terminar sin esa
 *    parte.
 *  · **Quien recibe el encargo trabaja con SUS permisos y SUS aprobaciones.**
 *    El que llama no presta los suyos. Si el compañero necesita el visto bueno
 *    del cliente, lo pide él, con su propia tarjeta y su propia huella.
 *  · **Límite de profundidad.** Un agente puede pedir ayuda; el que ayuda ya
 *    no. Sin esto, dos agentes que se llaman mutuamente encadenan encargos
 *    hasta agotar el saldo del cliente, y cada eslabón parece razonable visto
 *    de cerca.
 *  · **Nadie se llama a sí mismo, ni a quien ya está en la cadena.** Es el
 *    mismo ciclo por otra vía.
 *
 * Los créditos del compañero se suman al encargo del que llamó: el cliente
 * pidió UN trabajo y ve UN gasto, con el reparto en el registro.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import type { ResultadoTarea } from "./tipos.js";

/** Un compañero contratado en el espacio, tal y como lo ve quien pide ayuda. */
export type Companero = {
  readonly slug: string;
  /** El nombre que le puso el cliente. Es el que se enseña. */
  readonly nombre: string;
  /** Para qué sirve, en una línea: el modelo elige con esto. */
  readonly paraQue: string;
};

export type EncargoDelegado = {
  readonly slug: string;
  readonly titulo: string;
  readonly detalle: string;
  /** Cuántos eslabones lleva ya la cadena, contando este. */
  readonly profundidad: number;
};

/**
 * Lo que el worker sabe hacer y el paquete del oficio no: mirar la nómina del
 * espacio y ejecutar el encargo de otro agente con su propio contexto.
 */
export interface ColaboracionPort {
  /** Quién está contratado y disponible, sin contar al que pregunta. */
  companeros(): Promise<readonly Companero[]>;
  encargar(input: EncargoDelegado): Promise<ResultadoTarea>;
}

/** Un agente pide ayuda; el que ayuda, no. Dos eslabones y se acabó. */
export const PROFUNDIDAD_MAXIMA = 2;

export type OpcionesColaboracion = {
  readonly puerto: ColaboracionPort;
  /** Quién está pidiendo la ayuda. Nunca puede pedírsela a sí mismo. */
  readonly slugPropio: string;
  /** La cadena de agentes que ya intervino, del primero al actual. */
  readonly cadena: readonly string[];
};

export type ResultadoColaboracion = {
  readonly companero: string;
  readonly estado: ResultadoTarea["estado"];
  readonly resumen: string;
  readonly creditos: number;
  readonly acciones: number;
};

/**
 * La herramienta, construida con el puerto dentro.
 *
 * Se crea por ejecución y no se declara en un catálogo global a propósito: el
 * puerto lleva el espacio del cliente y la cadena de llamadas, y eso no puede
 * viajar por el contexto compartido donde el modelo podría influir.
 */
export function crearHerramientaDeColaboracion(
  opciones: OpcionesColaboracion,
): ToolDef<{ companero: string; encargo: string; detalle?: string }, unknown> {
  const { puerto, slugPropio, cadena } = opciones;

  return defineTool({
    slug: "pedir_ayuda_a_companero",
    label: "Pedir ayuda a un compañero",
    description:
      "Encarga una parte del trabajo a otro agente contratado por el cliente (por ejemplo, pedirle al de marketing que revise una campaña). Úsalo solo cuando la tarea necesite algo que TÚ no puedes hacer con tus herramientas. El compañero trabaja con sus propios permisos y pide sus propias aprobaciones.",
    whenToUse:
      "cuando una parte del encargo es claramente de otro oficio y ese agente está contratado",
    inputSchema: z.object({
      companero: z
        .string()
        .min(1)
        .max(60)
        .describe("Identificador del compañero, tal y como aparece en la lista de compañeros."),
      encargo: z
        .string()
        .min(10)
        .max(300)
        .describe("Qué necesitas de él, en una frase clara y completa."),
      detalle: z
        .string()
        .max(2000)
        .optional()
        .describe("Contexto que necesita para hacerlo bien: qué se busca, qué evitar, qué ya sabes."),
    }),
    sensitive: false,
    // Lo que gaste el compañero se cobra aparte, con su propia evidencia: aquí
    // no se cobra dos veces por el mismo trabajo.
    creditCost: 0,
    scopes: [],
    effect: "write_internal",
    kind: "system",
    async execute(_ctx, input): Promise<Record<string, unknown>> {
      if (cadena.length >= PROFUNDIDAD_MAXIMA) {
        return {
          ok: false,
          motivo:
            "Este encargo ya viene de otro compañero, y un agente que ayuda no puede pedir más ayuda. " +
            "Termina tú la parte que puedas y explica en el RESUMEN lo que falta.",
        };
      }

      const pedido = input.companero.trim().toLowerCase();
      if (pedido === slugPropio.toLowerCase()) {
        return { ok: false, motivo: "Ese eres tú. Haz esa parte con tus propias herramientas." };
      }
      if (cadena.some((c) => c.toLowerCase() === pedido)) {
        return {
          ok: false,
          motivo: `${pedido} ya está trabajando en esta cadena y no puede encargarse de otra parte ahora.`,
        };
      }

      const companeros = await puerto.companeros();
      const elegido = companeros.find((c) => c.slug.toLowerCase() === pedido);
      if (!elegido) {
        const disponibles = companeros.map((c) => c.slug).join(", ");
        return {
          ok: false,
          motivo: disponibles
            ? `El cliente no tiene contratado a "${input.companero}". Sus compañeros disponibles son: ${disponibles}. Si ninguno sirve, haz lo que puedas y dilo en el RESUMEN.`
            : `El cliente no tiene contratado a ningún compañero al que pedir ayuda. Haz lo que puedas con tus herramientas y dilo en el RESUMEN.`,
        };
      }

      const resultado = await puerto.encargar({
        slug: elegido.slug,
        titulo: input.encargo.trim(),
        detalle: input.detalle?.trim() ?? "",
        profundidad: cadena.length + 1,
      });

      const salida: ResultadoColaboracion = {
        companero: elegido.nombre,
        estado: resultado.estado,
        resumen:
          resultado.estado === "fallida"
            ? `No pudo terminarlo: ${resultado.error}`
            : resultado.resumen,
        creditos: resultado.evidencia.creditos,
        acciones: resultado.evidencia.acciones.length,
      };

      // Un compañero que se queda esperando un botón no bloquea al que llamó:
      // se le dice para que siga con el resto y lo cuente en su resumen.
      if (resultado.estado === "esperando_aprobacion") {
        return {
          ok: true,
          ...salida,
          nota: `${elegido.nombre} dejó algo esperando la aprobación del cliente. Sigue con lo que puedas y cuéntalo en el RESUMEN.`,
        };
      }
      return { ok: resultado.estado === "completada", ...salida };
    },
    simulate(_ctx, input) {
      return {
        simulado: true,
        companero: input.companero,
        nota: "Simulación: no se le encargó nada a nadie. Descríbelo en el plan.",
      };
    },
  });
}

/** Lista para el prompt: quién está en la oficina y para qué sirve cada uno. */
export function bloqueDeCompaneros(companeros: readonly Companero[]): string {
  if (companeros.length === 0) return "";
  const lista = companeros.map((c) => `- ${c.slug} (${c.nombre}): ${c.paraQue}`).join("\n");
  return (
    `\nCOMPAÑEROS DE LA EMPRESA\n` +
    `El cliente tiene contratados a estos agentes. Si una parte del encargo es claramente de su oficio ` +
    `y tú no puedes hacerla, pídesela con pedir_ayuda_a_companero. Nunca le pases una parte que sí puedes hacer tú.\n` +
    `${lista}\n`
  );
}
