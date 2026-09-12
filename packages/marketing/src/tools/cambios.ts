/**
 * Lo que toca el dinero del cliente. Nada de esto se ejecuta solo.
 *
 * Las tres herramientas de aquí pasan SIEMPRE por la puerta de aprobación, y
 * el texto que ve la persona dice el cambio en dinero al mes, no en
 * porcentajes: «de 30.000 a 50.000 al día, unos 600.000 más al mes» se entiende
 * y «+66%» no.
 *
 * Además se guarda el estado anterior como backup antes de cambiar nada: sin
 * eso, deshacer no es un botón sino una llamada de soporte.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { dinero, impactoMensual } from "../analisis.js";
import { puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import { adsDe, NOMBRE_PLATAFORMA, type Plataforma } from "../ports.js";
import { entorno } from "./comun.js";

const plataforma = z.enum(["google_ads", "meta_ads"]);

/** Tope de seguridad: multiplicar por diez el presupuesto nunca es un descuido aceptable. */
const VECES_MAXIMO = 3;

async function cuentaYPuerto(
  ctx: Parameters<typeof entorno>[0],
  slug: string,
  entrada: { plataforma: string; cuenta_id: string },
) {
  const { cuentas, workspaceId } = entorno(ctx, slug);
  const puerto = adsDe(cuentas, entrada.plataforma as Plataforma, slug);
  if (!puerto.puedeEscribir) {
    throw new Error(
      `La conexión con ${NOMBRE_PLATAFORMA[entrada.plataforma as Plataforma]} es de solo lectura: puedes proponer el cambio en el RESUMEN, pero no aplicarlo.`,
    );
  }
  const cuenta = (await puerto.cuentas()).find((c) => c.id === entrada.cuenta_id);
  if (!cuenta) {
    throw new Error(`La cuenta ${entrada.cuenta_id} no está entre las conectadas. Llama antes a ads_listar_cuentas.`);
  }
  return { cuentas, workspaceId, puerto, cuenta };
}

export const adsCambiarPresupuesto = defineTool({
  slug: "ads_cambiar_presupuesto",
  label: "Cambiar el presupuesto de una campaña",
  description:
    "Cambia el presupuesto diario de una campaña. Gasta dinero del cliente: SIEMPRE requiere que una persona lo apruebe.",
  whenToUse:
    "cuando hayas visto los números y tengas una razón concreta: subirle a la que mejor funciona o bajarle a la que se está llevando el dinero sin traer clientes",
  inputSchema: z.object({
    plataforma,
    cuenta_id: z.string().min(1),
    campana_id: z.string().min(1),
    diario: z.number().positive().describe("Nuevo presupuesto diario, en la moneda de la cuenta."),
    motivo: z
      .string()
      .min(10)
      .max(300)
      .describe("Por qué, con la cifra que lo sostiene. Lo lee el cliente antes de aprobar."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.adsWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { cuentas, workspaceId, puerto, cuenta } = await cuentaYPuerto(ctx, "ads_cambiar_presupuesto", input);
    const campanas = await puerto.campanas({
      cuentaId: cuenta.id,
      periodo: { desde: "1970-01-01", hasta: "1970-01-01" },
    });
    const campana = campanas.find((c) => c.id === input.campana_id);
    if (!campana) {
      throw new Error(`No encuentro la campaña ${input.campana_id} en esa cuenta.`);
    }
    const anterior = campana.presupuestoDiario;
    if (anterior !== undefined && input.diario > anterior * VECES_MAXIMO) {
      throw new Error(
        `Ese presupuesto es ${Math.round(input.diario / anterior)} veces el actual (${dinero(anterior, cuenta.moneda)}). ` +
          `Sube como mucho al triple de una vez, y explica el porqué en el motivo.`,
      );
    }

    const bloqueo = await puertaDeAprobacion({
      approvals: cuentas.approvals,
      workspaceId,
      taskId: cuentas.taskId,
      conexionId: cuentas.conexionId,
      toolSlug: "ads_cambiar_presupuesto",
      motivo: "cambia cuánto se gasta al día en publicidad",
      resumen:
        `Cambiar el presupuesto de «${campana.nombre}» en ${NOMBRE_PLATAFORMA[cuenta.plataforma]}. ` +
        (anterior === undefined
          ? `Ponerlo en ${dinero(input.diario, cuenta.moneda)} al día. `
          : `${impactoMensual(anterior, input.diario, cuenta.moneda)} `) +
        `Motivo: ${input.motivo}`,
      entrada: input,
    });
    if (bloqueo) return bloqueo;

    if (cuentas.backups) {
      await cuentas.backups.create({
        workspaceId,
        siteId: cuentas.conexionId,
        taskId: cuentas.taskId,
        alcance: `campana_presupuesto:${cuenta.id}:${campana.id}`,
        snapshot: { presupuestoDiario: anterior ?? null },
      });
    }

    const cambio = await puerto.cambiarPresupuesto({
      cuentaId: cuenta.id,
      campanaId: campana.id,
      diario: input.diario,
    });
    return {
      cambiado: true,
      campana: campana.nombre,
      antes: dinero(cambio.anterior, cuenta.moneda),
      ahora: dinero(cambio.nuevo, cuenta.moneda),
      al_mes: impactoMensual(cambio.anterior, cambio.nuevo, cuenta.moneda),
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      nota: "Simulación: el presupuesto no se cambió. Descríbelo en el plan y deja que el cliente decida.",
      campana_id: input.campana_id,
      diario: input.diario,
    };
  },
});

function cambiarEstado(slug: string, label: string, estado: "activa" | "pausada") {
  const verbo = estado === "pausada" ? "Pausar" : "Reactivar";
  return defineTool({
    slug,
    label,
    description:
      estado === "pausada"
        ? "Pausa una campaña: deja de gastar y de mostrarse. Requiere que una persona lo apruebe."
        : "Reactiva una campaña pausada: vuelve a gastar. Requiere que una persona lo apruebe.",
    whenToUse:
      estado === "pausada"
        ? "cuando una campaña lleve un gasto claro sin traer un solo resultado y ya lo hayas comprobado con ads_revisar_campanas"
        : "cuando el cliente pida volver a encender una campaña que estaba pausada",
    inputSchema: z.object({
      plataforma,
      cuenta_id: z.string().min(1),
      campana_id: z.string().min(1),
      motivo: z.string().min(10).max(300).describe("Por qué, con la cifra que lo sostiene."),
    }),
    sensitive: false,
    creditCost: 3,
    scopes: [SCOPES.adsWrite],
    effect: "write_external" as const,
    kind: "http" as const,
    async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
      const { cuentas, workspaceId, puerto, cuenta } = await cuentaYPuerto(ctx, slug, input);
      const campanas = await puerto.campanas({
        cuentaId: cuenta.id,
        periodo: { desde: "1970-01-01", hasta: "1970-01-01" },
      });
      const campana = campanas.find((c) => c.id === input.campana_id);
      if (!campana) throw new Error(`No encuentro la campaña ${input.campana_id} en esa cuenta.`);

      const gastoDiario =
        campana.presupuestoDiario === undefined
          ? ""
          : ` Hoy tiene ${dinero(campana.presupuestoDiario, cuenta.moneda)} al día.`;
      const bloqueo = await puertaDeAprobacion({
        approvals: cuentas.approvals,
        workspaceId,
        taskId: cuentas.taskId,
        conexionId: cuentas.conexionId,
        toolSlug: slug,
        motivo: estado === "pausada" ? "deja de mostrar anuncios" : "vuelve a gastar en publicidad",
        resumen: `${verbo} «${campana.nombre}» en ${NOMBRE_PLATAFORMA[cuenta.plataforma]}.${gastoDiario} Motivo: ${input.motivo}`,
        entrada: input,
      });
      if (bloqueo) return bloqueo;

      if (cuentas.backups) {
        await cuentas.backups.create({
          workspaceId,
          siteId: cuentas.conexionId,
          taskId: cuentas.taskId,
          alcance: `campana_estado:${cuenta.id}:${campana.id}`,
          snapshot: { estado: campana.estado },
        });
      }

      const cambio = await puerto.cambiarEstado({
        cuentaId: cuenta.id,
        campanaId: campana.id,
        estado,
      });
      return { cambiado: true, campana: campana.nombre, antes: cambio.anterior, ahora: cambio.nuevo };
    },
    simulate(_ctx, input) {
      return {
        simulado: true,
        nota: `Simulación: la campaña no se ${estado === "pausada" ? "pausó" : "reactivó"}. Descríbelo en el plan.`,
        campana_id: input.campana_id,
      };
    },
  });
}

export const adsPausarCampana = cambiarEstado("ads_pausar_campana", "Pausar una campaña", "pausada");
export const adsActivarCampana = cambiarEstado("ads_activar_campana", "Reactivar una campaña", "activa");

export const HERRAMIENTAS_CAMBIOS: readonly ToolDef<never, unknown>[] = [
  adsCambiarPresupuesto,
  adsPausarCampana,
  adsActivarCampana,
] as unknown as readonly ToolDef<never, unknown>[];
