/**
 * El informe del negocio: la herramienta del agente de Reportes.
 *
 * Devuelve el informe YA escrito, línea por línea. El modelo lo entrega y lo
 * comenta; no vuelve a hacer las cuentas ni reescribe las cifras. Es la misma
 * razón por la que las demás herramientas de este paquete devuelven texto
 * legible: un modelo sumando pesos se equivoca, y un informe con un número mal
 * es peor que no tener informe.
 *
 * Lee de dos maneras según lo que el sistema contable ofrezca: si sabe paginar
 * (`facturasTodas`, `cobrosTodos`), se lee todo; si no, se cae a la lectura de
 * una página y el informe AVISA de que pudo quedarse corto.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { dinero } from "../analisis.js";
import {
  informeDelNegocio,
  periodoAnterior,
  titularDelInforme,
  type Faltante,
  type Periodo,
} from "../informe.js";
import { requireContabilidad, type Cobro, type ContabilidadPort, type Factura } from "../ports.js";
import { entorno, ultimosDias } from "./comun.js";

/** Una página de Alegra. Si vuelve llena, es que probablemente hay más. */
const PAGINA = 30;

/** Todas las facturas que se puedan, diciendo si se llegó al final. */
async function leerFacturas(
  contabilidad: ContabilidadPort,
): Promise<{ items: readonly Factura[]; completo: boolean }> {
  if (contabilidad.facturasTodas) return contabilidad.facturasTodas({ estado: "abierta" });
  const items = await contabilidad.facturas({ estado: "abierta" });
  return { items, completo: items.length < PAGINA };
}

/** Los cobros de un periodo, con la misma honestidad sobre si están todos. */
async function leerCobros(
  contabilidad: ContabilidadPort,
  periodo: Periodo,
): Promise<{ items: readonly Cobro[]; completo: boolean }> {
  if (contabilidad.cobrosTodos) return contabilidad.cobrosTodos(periodo);
  const items = await contabilidad.cobros(periodo);
  return { items, completo: items.length < PAGINA };
}

export const adminInformeDelNegocio = defineTool({
  slug: "admin_informe_del_negocio",
  label: "Preparar el informe del negocio",
  description:
    "El informe completo de cómo va el negocio en un periodo: cuánto entró y cuánto salió, cuánto le deben y desde cuándo, qué vence la semana que viene, quién debe más, y todo comparado con el periodo anterior de la misma duración. Devuelve el informe ya escrito: entrégalo tal cual.",
  whenToUse:
    "para cualquier encargo del tipo «cómo vamos», «el informe del mes», «resumen del negocio» o «mándame cómo va la cosa»",
  inputSchema: z.object({
    dias: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe(
        "Cuántos días cubre el informe, contando hoy. 30 para el mes, 7 para la semana. Se compara solo con los mismos días justo anteriores.",
      ),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_informe_del_negocio");
    const contabilidad = requireContabilidad(libros, "admin_informe_del_negocio");
    const hoy = ctx.now();
    const moneda = await contabilidad.monedaBase();

    const periodo = ultimosDias(input.dias, hoy);
    const anterior = periodoAnterior(periodo);

    const [facturas, cobros, cobrosAnteriores] = await Promise.all([
      leerFacturas(contabilidad),
      leerCobros(contabilidad, periodo),
      leerCobros(contabilidad, anterior),
    ]);

    // Lo que salió solo lo tienen algunos sistemas. Sin ello el informe dice lo
    // que entró y admite que no puede hablar del saldo, en vez de insinuarlo.
    const egresos = contabilidad.egresos ? await contabilidad.egresos(periodo) : null;
    const egresosAnteriores =
      contabilidad.egresos && egresos ? await contabilidad.egresos(anterior) : null;

    const faltantes: Faltante[] = [];
    if (!facturas.completo) faltantes.push("facturas");
    if (!cobros.completo) faltantes.push("cobros");
    if (!cobrosAnteriores.completo) faltantes.push("cobros_anteriores");

    const informe = informeDelNegocio({
      moneda,
      periodo,
      facturas: facturas.items,
      cobros: cobros.items,
      cobrosAnteriores: cobrosAnteriores.items,
      ...(egresos ? { egresos: egresos.items } : {}),
      ...(egresosAnteriores ? { egresosAnteriores: egresosAnteriores.items } : {}),
      hoy,
      faltantes,
    });

    return {
      sistema: contabilidad.sistema,
      periodo: informe.periodo,
      periodo_comparado: informe.periodoComparado,
      moneda,
      titular: titularDelInforme(informe),
      // El informe entero, ya escrito. Se entrega tal cual: no hay que sumar
      // nada ni reformular las cifras.
      informe: informe.lineas,
      entro: dinero(informe.entro.actual, moneda),
      entro_antes: dinero(informe.entro.anterior, moneda),
      salio: informe.salio ? dinero(informe.salio.actual, moneda) : null,
      saldo_del_periodo: informe.diferencia === null ? null : dinero(informe.diferencia, moneda),
      te_deben: dinero(informe.caja.porCobrar, moneda),
      vencido: dinero(informe.caja.vencido, moneda),
      vence_la_proxima_semana: dinero(informe.caja.venceEstaSemana, moneda),
      quien_debe_mas: informe.deudores.map((d) => ({
        cliente: d.cliente,
        debe: dinero(d.total, moneda),
        facturas: d.facturas,
        dias_de_atraso: d.atrasoMaximo,
      })),
      datos_incompletos: informe.faltantes.length > 0 ? informe.faltantes : undefined,
    };
  },
});

export const HERRAMIENTAS_INFORME: readonly ToolDef<never, unknown>[] = [
  adminInformeDelNegocio,
] as unknown as readonly ToolDef<never, unknown>[];
