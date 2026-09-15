/**
 * Lo que el agente puede mirar sin pedir permiso a nadie.
 *
 * Todas estas herramientas son de solo lectura y devuelven las cifras YA
 * interpretadas: el coste por resultado calculado, las cantidades escritas en
 * la moneda de la cuenta y los hallazgos en lenguaje de negocio. El modelo no
 * tiene que hacer cuentas —se equivoca— y tampoco tiene que decidir qué es caro
 * —cambiaría de criterio cada vez—.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { analizar, costePorResultado, dinero, frasePeriodo, resumir } from "../analisis.js";
import { adsDe, requireAnalytics, NOMBRE_PLATAFORMA, PLATAFORMAS, type Plataforma } from "../ports.js";
import { entorno, ultimosDias } from "./comun.js";

const plataforma = z.enum(PLATAFORMAS);
const dias = z
  .number()
  .int()
  .min(1)
  .max(90)
  .default(7)
  .describe("Cuántos días hacia atrás mirar. Termina ayer: el día en curso está a medias.");

export const adsListarCuentas = defineTool({
  slug: "ads_listar_cuentas",
  label: "Ver las cuentas de publicidad",
  description:
    "Lista las cuentas publicitarias conectadas (Google Ads, Facebook/Instagram y TikTok) con su nombre y su moneda.",
  whenToUse: "siempre lo primero, para saber con qué cuentas puedes trabajar y en qué moneda hablar",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.adsRead],
  effect: "read",
  kind: "http",
  async execute(ctx): Promise<Record<string, unknown>> {
    const { cuentas } = entorno(ctx, "ads_listar_cuentas");
    if (cuentas.ads.length === 0) {
      return {
        cuentas: [],
        nota: "No hay ninguna plataforma de anuncios conectada. Díselo al cliente: sin conexión no puedo ver sus campañas.",
      };
    }
    const salida = [];
    for (const puerto of cuentas.ads) {
      for (const c of await puerto.cuentas()) {
        salida.push({
          id: c.id,
          plataforma: c.plataforma,
          plataforma_nombre: NOMBRE_PLATAFORMA[c.plataforma],
          nombre: c.nombre,
          moneda: c.moneda,
          puedo_cambiar_cosas: puerto.puedeEscribir,
        });
      }
    }
    return { cuentas: salida };
  },
});

export const adsRevisarCampanas = defineTool({
  slug: "ads_revisar_campanas",
  label: "Revisar cómo van las campañas",
  description:
    "Trae las campañas de una cuenta con lo que gastaron y lo que trajeron en el periodo, el coste por resultado ya calculado, y los hallazgos: qué campaña está tirando el dinero y cuál es la que mejor funciona.",
  whenToUse:
    "para cualquier encargo del tipo «cómo van mis campañas», «en qué estoy tirando el dinero» o antes de proponer cualquier cambio",
  inputSchema: z.object({
    plataforma,
    cuenta_id: z.string().min(1),
    dias,
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.adsRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { cuentas } = entorno(ctx, "ads_revisar_campanas");
    const puerto = adsDe(cuentas, input.plataforma as Plataforma, "ads_revisar_campanas");
    const cuenta = (await puerto.cuentas()).find((c) => c.id === input.cuenta_id);
    if (!cuenta) {
      throw new Error(
        `La cuenta ${input.cuenta_id} no está entre las conectadas de ${NOMBRE_PLATAFORMA[input.plataforma as Plataforma]}. Llama antes a ads_listar_cuentas.`,
      );
    }
    const periodo = ultimosDias(input.dias, ctx.now());
    const campanas = await puerto.campanas({ cuentaId: cuenta.id, periodo });
    const resumen = resumir(campanas, periodo, cuenta.moneda);

    return {
      cuenta: { id: cuenta.id, nombre: cuenta.nombre, moneda: cuenta.moneda },
      periodo,
      resumen_legible: frasePeriodo(resumen),
      total: {
        gasto: dinero(resumen.gasto, cuenta.moneda),
        resultados: resumen.resultados,
        coste_por_resultado:
          resumen.costePorResultado === null ? null : dinero(resumen.costePorResultado, cuenta.moneda),
        campanas_activas: resumen.activas,
      },
      campanas: campanas.map((c) => {
        const coste = costePorResultado(c.metricas);
        return {
          id: c.id,
          nombre: c.nombre,
          estado: c.estado,
          presupuesto_diario:
            c.presupuestoDiario === undefined ? null : dinero(c.presupuestoDiario, cuenta.moneda),
          gasto: dinero(c.metricas.gasto, cuenta.moneda),
          clics: c.metricas.clics,
          resultados: c.metricas.conversiones,
          coste_por_resultado: coste === null ? null : dinero(coste, cuenta.moneda),
        };
      }),
      hallazgos: analizar(campanas, cuenta.moneda),
      nota: puerto.puedeEscribir
        ? undefined
        : "Esta conexión es de solo lectura: puedes analizar y proponer, pero no cambiar nada.",
    };
  },
});

export const analyticsResumenWeb = defineTool({
  slug: "analytics_resumen_web",
  label: "Ver qué pasa en la web",
  description:
    "Resumen de Google Analytics para el periodo: visitas, personas distintas, resultados y de dónde llega la gente.",
  whenToUse:
    "para entender si los anuncios traen visitas que hacen algo, y para comparar lo que pagas con lo que llega gratis",
  inputSchema: z.object({
    propiedad_id: z.string().min(1).optional().describe("Si se omite, se usa la primera propiedad conectada."),
    dias,
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.analyticsRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { cuentas } = entorno(ctx, "analytics_resumen_web");
    const analytics = requireAnalytics(cuentas, "analytics_resumen_web");
    const propiedades = await analytics.propiedades();
    const propiedadId = input.propiedad_id ?? propiedades[0]?.id;
    if (!propiedadId) {
      return {
        nota: "No hay ninguna propiedad de Analytics conectada. Díselo al cliente.",
      };
    }
    const periodo = ultimosDias(input.dias, ctx.now());
    const r = await analytics.resumen({ propiedadId, periodo });
    const total = r.canales.reduce((s, c) => s + c.sesiones, 0);
    return {
      periodo,
      visitas: r.sesiones,
      personas: r.usuarios,
      resultados: r.conversiones,
      de_donde_llegan: r.canales.map((c) => ({
        canal: c.nombre,
        visitas: c.sesiones,
        parte: total > 0 ? `${Math.round((c.sesiones / total) * 100)}%` : "0%",
        resultados: c.conversiones,
      })),
    };
  },
});

export const HERRAMIENTAS_LECTURA: readonly ToolDef<never, unknown>[] = [
  adsListarCuentas,
  adsRevisarCampanas,
  analyticsResumenWeb,
] as unknown as readonly ToolDef<never, unknown>[];
