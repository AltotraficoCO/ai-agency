/**
 * Lo que el agente puede mirar sin pedir permiso a nadie.
 *
 * Todas estas herramientas son de solo lectura y devuelven las cifras YA
 * sumadas, convertidas a la moneda del negocio y escritas en lenguaje llano. El
 * modelo no tiene que hacer cuentas —se equivoca— ni decidir qué es urgente
 * —cambiaría de criterio cada vez—.
 *
 * Y hay un límite que no es de rendimiento sino de privacidad: por muchas
 * facturas que tenga el cliente, aquí solo bajan las que se van a mencionar.
 * Lo que no viaja no se puede filtrar en un resumen.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import {
  dinero,
  estadoDeCaja,
  fraseDeCaja,
  fraseDeFactura,
  frasesDeReparto,
  importeLegible,
  NOMBRE_TRAMO,
  pendientes,
  repartoPorTramo,
} from "../analisis.js";
import { requireContabilidad } from "../ports.js";
import { entorno, ultimosDias } from "./comun.js";

const dias = z
  .number()
  .int()
  .min(1)
  .max(365)
  .default(30)
  .describe("Cuántos días hacia atrás mirar los pagos recibidos. Incluye hoy.");

/** Cuántas facturas se nombran una a una. El resto va en totales. */
const DETALLE_MAXIMO = 5;

export const adminEstadoDeCaja = defineTool({
  slug: "admin_estado_de_caja",
  label: "Ver cómo está la caja",
  description:
    "Dice cuánto le deben al negocio, cuánto de eso está vencido, qué vence esta semana y cuánto dinero entró en el periodo. Todo sumado y en la moneda del negocio.",
  whenToUse:
    "siempre lo primero, y para cualquier encargo del tipo «cómo vamos», «cuánto nos deben» o «cuánta plata entró»",
  inputSchema: z.object({ dias }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_estado_de_caja");
    const contabilidad = requireContabilidad(libros, "admin_estado_de_caja");
    const moneda = await contabilidad.monedaBase();
    const periodo = ultimosDias(input.dias, ctx.now());

    const [facturas, cobros] = await Promise.all([
      contabilidad.facturas({ estado: "abierta" }),
      contabilidad.cobros({ desde: periodo.desde, hasta: periodo.hasta }),
    ]);

    const caja = estadoDeCaja({ facturas, cobros, moneda, hoy: ctx.now() });
    const lista = pendientes(facturas, ctx.now());
    const reparto = repartoPorTramo(lista);

    return {
      sistema: contabilidad.sistema,
      periodo,
      moneda,
      resumen_legible: fraseDeCaja(caja),
      te_deben: dinero(caja.porCobrar, moneda),
      vencido: dinero(caja.vencido, moneda),
      vence_esta_semana: dinero(caja.venceEstaSemana, moneda),
      entro_en_el_periodo: dinero(caja.cobrado, moneda),
      facturas_sin_pagar: caja.facturasAbiertas,
      facturas_vencidas: caja.facturasVencidas,
      pagos_recibidos: caja.cobros,
      por_antiguedad: frasesDeReparto(reparto, moneda),
      lo_mas_urgente: lista.slice(0, 3).map((p) => fraseDeFactura(p, moneda)),
      nota: contabilidad.puedeEscribir
        ? undefined
        : `La conexión con ${contabilidad.sistema} es de solo lectura: puedes analizar y proponer, pero no emitir nada.`,
    };
  },
});

export const adminFacturasPorCobrar = defineTool({
  slug: "admin_facturas_por_cobrar",
  label: "Ver las facturas sin pagar",
  description:
    "Lista las facturas que siguen sin pagarse, ordenadas por lo que más pesa: dinero parado por tiempo parado. Dice de quién es cada una, cuánto falta y desde cuándo.",
  whenToUse: "cuando el encargo vaya de cobrar, de perseguir deudas o de saber quién debe qué",
  inputSchema: z.object({
    cuantas: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(DETALLE_MAXIMO)
      .describe("Cuántas facturas nombrar una a una. El resto va en totales."),
    solo_vencidas: z
      .boolean()
      .default(false)
      .describe("true para dejar fuera las que todavía no vencen."),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_facturas_por_cobrar");
    const contabilidad = requireContabilidad(libros, "admin_facturas_por_cobrar");
    const moneda = await contabilidad.monedaBase();
    const facturas = await contabilidad.facturas({ estado: "abierta" });

    const todas = pendientes(facturas, ctx.now());
    const lista = input.solo_vencidas ? todas.filter((p) => p.dias > 0) : todas;
    const mostradas = lista.slice(0, input.cuantas);

    return {
      moneda,
      total_sin_pagar: dinero(
        lista.reduce((s, p) => s + p.factura.saldo.enMonedaBase, 0),
        moneda,
      ),
      cuantas_hay: lista.length,
      por_antiguedad: frasesDeReparto(repartoPorTramo(lista), moneda),
      facturas: mostradas.map((p) => ({
        numero: p.factura.numero,
        cliente: p.factura.cliente.nombre,
        cliente_id: p.factura.cliente.id,
        falta_por_cobrar: importeLegible(p.factura.saldo, moneda),
        vence: p.factura.vence,
        dias_de_atraso: p.dias > 0 ? p.dias : 0,
        antiguedad: NOMBRE_TRAMO[p.tramo],
        legible: fraseDeFactura(p, moneda),
      })),
      nota:
        lista.length > mostradas.length
          ? `Hay ${lista.length - mostradas.length} facturas más que no se listan aquí. No las inventes: si el cliente las pide, vuelve a llamar con "cuantas" mayor.`
          : undefined,
    };
  },
});

export const adminBuscarCliente = defineTool({
  slug: "admin_buscar_cliente",
  label: "Buscar un cliente",
  description:
    "Busca un cliente del negocio por su nombre y devuelve su identificador, que es lo que hace falta para emitirle una factura.",
  whenToUse: "antes de emitir una factura, para estar seguro de a quién se le emite",
  inputSchema: z.object({
    texto: z.string().min(2).max(120).describe("Parte del nombre del cliente."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_buscar_cliente");
    const contabilidad = requireContabilidad(libros, "admin_buscar_cliente");
    const encontrados = await contabilidad.buscarClientes({ texto: input.texto, limite: 8 });
    if (encontrados.length === 0) {
      return {
        clientes: [],
        nota: `No hay ningún cliente que se llame así en ${contabilidad.sistema}. Pregúntale al cliente cómo está registrado, no lo adivines.`,
      };
    }
    return {
      clientes: encontrados.map((c) => ({ id: c.id, nombre: c.nombre })),
      nota:
        encontrados.length > 1
          ? "Hay más de uno con ese nombre: pregunta cuál antes de emitir nada."
          : undefined,
    };
  },
});

export const HERRAMIENTAS_LECTURA: readonly ToolDef<never, unknown>[] = [
  adminEstadoDeCaja,
  adminFacturasPorCobrar,
  adminBuscarCliente,
] as unknown as readonly ToolDef<never, unknown>[];
