/**
 * El criterio del agente: qué hay que cobrar primero y cómo se dice.
 *
 * Módulo puro, sin red y sin modelo. Está aparte porque es lo único que de
 * verdad se puede probar: si «esta factura es urgente» dependiera de lo que el
 * modelo opine ese día, el dueño recibiría una lista distinta cada lunes con
 * los mismos números.
 *
 * Dos decisiones que no son de estilo:
 *  · **Se ordena por dinero parado, no por antigüedad.** Una factura de cien
 *    mil pesos de hace un año molesta; una de veinte millones de hace dos meses
 *    es un problema de caja. Se multiplica lo que se debe por el tiempo que
 *    lleva sin pagarse, que es lo que de verdad duele.
 *  · **Los tramos se dicen en meses, no en días.** «Más de tres meses» lo
 *    entiende cualquiera; «cartera a 90 días» es jerga de contador.
 */
import type { Cobro, Factura, Importe, Moneda } from "./ports.js";

/** Tramos de antigüedad, en días cumplidos. */
export type Tramo = "al_dia" | "menos_de_un_mes" | "uno_a_dos_meses" | "dos_a_tres_meses" | "mas_de_tres_meses";

export const NOMBRE_TRAMO: Readonly<Record<Tramo, string>> = {
  al_dia: "todavía no vencen",
  menos_de_un_mes: "menos de un mes de atraso",
  uno_a_dos_meses: "entre uno y dos meses de atraso",
  dos_a_tres_meses: "entre dos y tres meses de atraso",
  mas_de_tres_meses: "más de tres meses de atraso",
};

const DIA_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD en UTC: los sistemas contables trabajan con fechas, no con instantes. */
export function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Días de atraso de una factura. Negativo significa que aún no vence.
 *
 * Se compara por fecha y no por instante: una factura que vence hoy no lleva
 * «medio día» de atraso, lleva cero.
 */
export function diasDeAtraso(vence: string, hoy: Date): number {
  const limite = Date.parse(`${vence}T00:00:00.000Z`);
  const ahora = Date.parse(`${fecha(hoy)}T00:00:00.000Z`);
  if (Number.isNaN(limite)) return 0;
  return Math.round((ahora - limite) / DIA_MS);
}

export function tramoDe(dias: number): Tramo {
  if (dias <= 0) return "al_dia";
  if (dias <= 30) return "menos_de_un_mes";
  if (dias <= 60) return "uno_a_dos_meses";
  if (dias <= 90) return "dos_a_tres_meses";
  return "mas_de_tres_meses";
}

/**
 * Escribe una cantidad como la lee el dueño del negocio.
 *
 * En pesos colombianos nadie escribe decimales: «42.353.985 pesos», no
 * «42.353.984,61». En dólares sí importan los centavos.
 */
export function dinero(valor: number, moneda: Moneda): string {
  const sinDecimales = ["COP", "CLP", "PYG", "JPY", "KRW", "VND", "ISK"].includes(moneda.toUpperCase());
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda.toUpperCase(),
    minimumFractionDigits: sinDecimales ? 0 : 2,
    maximumFractionDigits: sinDecimales ? 0 : 2,
  }).format(valor);
}

/** Suma importes en la moneda del negocio, que es la única que se puede sumar. */
export function sumar(importes: readonly Importe[]): number {
  return importes.reduce((s, i) => s + i.enMonedaBase, 0);
}

/**
 * Un importe dicho al dueño del negocio.
 *
 * Si el documento está en otra moneda se enseñan las dos: el cliente paga 955
 * dólares, pero en la caja del negocio eso son unos 3 millones de pesos, y
 * ambas cifras importan. Enseñar solo una de las dos confunde.
 */
export function importeLegible(importe: Importe, monedaBase: Moneda): string {
  const propio = dinero(importe.valor, importe.moneda);
  if (importe.moneda.toUpperCase() === monedaBase.toUpperCase()) return propio;
  return `${propio} (unos ${dinero(importe.enMonedaBase, monedaBase)})`;
}

export type FacturaPendiente = {
  readonly factura: Factura;
  readonly dias: number;
  readonly tramo: Tramo;
  /** Dinero parado por tiempo parado: lo que de verdad duele. */
  readonly peso: number;
};

/** Las facturas que siguen abiertas, ordenadas por lo que más duele. */
export function pendientes(facturas: readonly Factura[], hoy: Date): readonly FacturaPendiente[] {
  return facturas
    .filter((f) => f.estado === "abierta" && f.saldo.enMonedaBase > 0)
    .map((factura) => {
      const dias = diasDeAtraso(factura.vence, hoy);
      return {
        factura,
        dias,
        tramo: tramoDe(dias),
        peso: factura.saldo.enMonedaBase * Math.max(dias, 0),
      };
    })
    .sort((a, b) => {
      if (b.peso !== a.peso) return b.peso - a.peso;
      // Sin atraso el peso es cero: entonces manda lo que vence antes.
      return a.dias === b.dias ? b.factura.saldo.enMonedaBase - a.factura.saldo.enMonedaBase : b.dias - a.dias;
    });
}

export type Reparto = {
  readonly tramo: Tramo;
  readonly facturas: number;
  readonly total: number;
};

/** Cuánto hay en cada tramo, para poder decir «12 llevan más de dos meses». */
export function repartoPorTramo(lista: readonly FacturaPendiente[]): readonly Reparto[] {
  const orden: readonly Tramo[] = [
    "al_dia",
    "menos_de_un_mes",
    "uno_a_dos_meses",
    "dos_a_tres_meses",
    "mas_de_tres_meses",
  ];
  return orden
    .map((tramo) => {
      const dentro = lista.filter((p) => p.tramo === tramo);
      return {
        tramo,
        facturas: dentro.length,
        total: dentro.reduce((s, p) => s + p.factura.saldo.enMonedaBase, 0),
      };
    })
    .filter((r) => r.facturas > 0);
}

export type EstadoDeCaja = {
  readonly moneda: Moneda;
  /** Todo lo que está por cobrar, vencido o no. */
  readonly porCobrar: number;
  readonly facturasAbiertas: number;
  /** Lo vencido, que es lo que hay que perseguir. */
  readonly vencido: number;
  readonly facturasVencidas: number;
  /** Lo que vence en los próximos días. */
  readonly venceEstaSemana: number;
  readonly facturasEstaSemana: number;
  /** Lo que entró en el periodo mirado. */
  readonly cobrado: number;
  readonly cobros: number;
};

export function estadoDeCaja(input: {
  facturas: readonly Factura[];
  cobros: readonly Cobro[];
  moneda: Moneda;
  hoy: Date;
  diasDeSemana?: number;
}): EstadoDeCaja {
  const lista = pendientes(input.facturas, input.hoy);
  const vencidas = lista.filter((p) => p.dias > 0);
  const dentroDe = input.diasDeSemana ?? 7;
  const estaSemana = lista.filter((p) => p.dias <= 0 && -p.dias <= dentroDe);
  return {
    moneda: input.moneda,
    porCobrar: lista.reduce((s, p) => s + p.factura.saldo.enMonedaBase, 0),
    facturasAbiertas: lista.length,
    vencido: vencidas.reduce((s, p) => s + p.factura.saldo.enMonedaBase, 0),
    facturasVencidas: vencidas.length,
    venceEstaSemana: estaSemana.reduce((s, p) => s + p.factura.saldo.enMonedaBase, 0),
    facturasEstaSemana: estaSemana.length,
    cobrado: sumar(input.cobros.map((c) => c.importe)),
    cobros: input.cobros.length,
  };
}

/**
 * El estado de caja dicho como se lo cuenta un empleado al dueño.
 *
 * Pedro lo pidió así: «que al final le diga: tenemos tanta plata, nos falta
 * tanta plata».
 */
export function fraseDeCaja(e: EstadoDeCaja): string {
  if (e.facturasAbiertas === 0) {
    return e.cobros > 0
      ? `No te debe nadie: todas tus facturas están pagadas. En el periodo entraron ${dinero(e.cobrado, e.moneda)}.`
      : "No te debe nadie: todas tus facturas están pagadas.";
  }
  const partes = [
    `Te deben ${dinero(e.porCobrar, e.moneda)} en ${e.facturasAbiertas} ${e.facturasAbiertas === 1 ? "factura" : "facturas"}`,
  ];
  if (e.vencido > 0) {
    partes.push(
      `de los cuales ${dinero(e.vencido, e.moneda)} ya están vencidos (${e.facturasVencidas} ${
        e.facturasVencidas === 1 ? "factura" : "facturas"
      })`,
    );
  } else {
    partes.push("y ninguna está vencida");
  }
  if (e.facturasEstaSemana > 0) {
    partes.push(`esta semana vencen ${dinero(e.venceEstaSemana, e.moneda)}`);
  }
  if (e.cobros > 0) {
    partes.push(`y en el periodo entraron ${dinero(e.cobrado, e.moneda)}`);
  }
  return `${partes.join(", ")}.`;
}

/** Una línea por tramo: «12 facturas llevan más de tres meses: 18.400.000 pesos». */
export function frasesDeReparto(reparto: readonly Reparto[], moneda: Moneda): readonly string[] {
  return reparto.map(
    (r) =>
      `${r.facturas} ${r.facturas === 1 ? "factura" : "facturas"} con ${NOMBRE_TRAMO[r.tramo]}: ${dinero(r.total, moneda)}`,
  );
}

/**
 * Cómo se dice una factura concreta al dueño.
 *
 * Lleva el nombre del cliente porque sin él no se puede cobrar, pero nunca su
 * identificación ni sus datos de contacto: eso está en el sistema contable y el
 * agente no necesita moverlo.
 */
export function fraseDeFactura(p: FacturaPendiente, monedaBase: Moneda): string {
  const cuanto = importeLegible(p.factura.saldo, monedaBase);
  if (p.dias > 0) {
    return `${p.factura.cliente.nombre} debe ${cuanto} de la factura ${p.factura.numero}, vencida hace ${p.dias} ${p.dias === 1 ? "día" : "días"}.`;
  }
  if (p.dias === 0) {
    return `${p.factura.cliente.nombre} debe ${cuanto} de la factura ${p.factura.numero}, que vence hoy.`;
  }
  const faltan = -p.dias;
  return `${p.factura.cliente.nombre} debe ${cuanto} de la factura ${p.factura.numero}, que vence en ${faltan} ${faltan === 1 ? "día" : "días"}.`;
}

/**
 * El texto del recordatorio de cobro, listo para que lo envíe Comunicaciones.
 *
 * Cortés y concreto: quien cobra mal pierde al cliente, y quien no cobra pierde
 * el negocio. Sin amenazas, sin mayúsculas y con el dato que hace falta para
 * pagar.
 */
export function textoDeRecordatorio(p: FacturaPendiente, negocio: string): string {
  const cuanto = dinero(p.factura.saldo.valor, p.factura.saldo.moneda);
  if (p.dias > 0) {
    return (
      `Hola ${p.factura.cliente.nombre}, te escribo de ${negocio}. ` +
      `Tenemos pendiente la factura ${p.factura.numero} por ${cuanto}, que venció hace ${p.dias} ${p.dias === 1 ? "día" : "días"}. ` +
      `¿Nos ayudas con el pago o prefieres que te la reenviemos? Gracias.`
    );
  }
  const faltan = Math.max(-p.dias, 0);
  return (
    `Hola ${p.factura.cliente.nombre}, te escribo de ${negocio}. ` +
    `Te recuerdo que la factura ${p.factura.numero} por ${cuanto} vence ${faltan === 0 ? "hoy" : `en ${faltan} ${faltan === 1 ? "día" : "días"}`}. ` +
    `Si ya la pagaste, ignora este mensaje. Gracias.`
  );
}

/** Lo que costaría una factura antes de emitirla, para que la aprobación diga cifras. */
export function totalDelBorrador(
  lineas: readonly { cantidad: number; precio: number; impuestoPorcentaje?: number }[],
): { readonly subtotal: number; readonly impuestos: number; readonly total: number } {
  let subtotal = 0;
  let impuestos = 0;
  for (const l of lineas) {
    const base = l.cantidad * l.precio;
    subtotal += base;
    impuestos += base * ((l.impuestoPorcentaje ?? 0) / 100);
  }
  return { subtotal, impuestos, total: subtotal + impuestos };
}
