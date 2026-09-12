/**
 * El informe del negocio en una página.
 *
 * Es el encargo que Pedro describió con sus palabras: «que al final a usted le
 * diga: tenemos tanta plata, nos falta tanta plata». Módulo puro, sin red y sin
 * modelo, por la misma razón que `analisis.ts`: si «te va peor que el mes
 * pasado» dependiera de lo que el modelo opine ese lunes, el dueño recibiría un
 * informe distinto cada semana con los mismos números.
 *
 * Tres decisiones que no son de estilo:
 *
 *  · **Un dato solo es noticia comparado con algo.** «Te deben 42 millones» no
 *    dice si el negocio va bien o mal. «Te deben 8 millones más que el mes
 *    pasado, y casi todo es de un solo cliente» sí. Por eso todo se mide contra
 *    el periodo anterior de la misma longitud.
 *
 *  · **Si falta un dato, se dice.** Un informe con totales incompletos es peor
 *    que no tener informe: el dueño decide con un número que parece completo.
 *    Cuando la lectura se queda corta o el sistema no expone los pagos que
 *    salieron, el informe lo admite en su propio texto.
 *
 *  · **Los deudores se agrupan por cliente, no por factura.** Al dueño no le
 *    sirve «tres facturas de 6, 5 y 4 millones»; le sirve «Constructora del
 *    Valle te debe 15 millones».
 */
import { dinero, diasDeAtraso, estadoDeCaja, pendientes, type EstadoDeCaja } from "./analisis.js";
import type { Cobro, Factura, Moneda } from "./ports.js";

const DIA_MS = 24 * 60 * 60 * 1000;

export type Periodo = {
  /** YYYY-MM-DD, incluido. */
  readonly desde: string;
  /** YYYY-MM-DD, incluido. */
  readonly hasta: string;
};

/** Cuántos días cubre un periodo, contando los dos extremos. */
export function diasDelPeriodo(p: Periodo): number {
  const desde = Date.parse(`${p.desde}T00:00:00.000Z`);
  const hasta = Date.parse(`${p.hasta}T00:00:00.000Z`);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return 0;
  return Math.round((hasta - desde) / DIA_MS) + 1;
}

/**
 * El periodo de la misma longitud que termina justo antes.
 *
 * No se usa «el mes pasado» de calendario: si el cliente pide los últimos 15
 * días, comparar contra un mes entero diría que todo bajó a la mitad y sería
 * mentira. La comparación honesta es contra el mismo número de días.
 */
export function periodoAnterior(p: Periodo): Periodo {
  const dias = diasDelPeriodo(p);
  const desde = Date.parse(`${p.desde}T00:00:00.000Z`);
  if (Number.isNaN(desde) || dias <= 0) return p;
  const finAnterior = new Date(desde - DIA_MS);
  const inicioAnterior = new Date(finAnterior.getTime() - (dias - 1) * DIA_MS);
  return {
    desde: inicioAnterior.toISOString().slice(0, 10),
    hasta: finAnterior.toISOString().slice(0, 10),
  };
}

export type DeudorDestacado = {
  readonly cliente: string;
  readonly total: number;
  readonly facturas: number;
  /** Días de atraso de su factura más vieja. 0 si ninguna venció. */
  readonly atrasoMaximo: number;
};

/** Quién debe más, agrupando todas sus facturas. */
export function deudoresDestacados(
  facturas: readonly Factura[],
  hoy: Date,
  cuantos = 3,
): readonly DeudorDestacado[] {
  const porCliente = new Map<string, { total: number; facturas: number; atraso: number }>();
  for (const p of pendientes(facturas, hoy)) {
    const nombre = p.factura.cliente.nombre;
    const actual = porCliente.get(nombre) ?? { total: 0, facturas: 0, atraso: 0 };
    porCliente.set(nombre, {
      total: actual.total + p.factura.saldo.enMonedaBase,
      facturas: actual.facturas + 1,
      atraso: Math.max(actual.atraso, p.dias > 0 ? p.dias : 0),
    });
  }
  return [...porCliente.entries()]
    .map(([cliente, d]) => ({
      cliente,
      total: d.total,
      facturas: d.facturas,
      atrasoMaximo: d.atraso,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, cuantos);
}

export type Comparacion = {
  readonly actual: number;
  readonly anterior: number;
  readonly diferencia: number;
  /** Null cuando el periodo anterior fue cero: un porcentaje sobre cero no significa nada. */
  readonly porcentaje: number | null;
};

export function comparar(actual: number, anterior: number): Comparacion {
  const diferencia = actual - anterior;
  return {
    actual,
    anterior,
    diferencia,
    porcentaje: anterior > 0 ? Math.round((diferencia / anterior) * 100) : null,
  };
}

/** Lo que no se pudo leer, para poder decirlo en el informe. */
export type Faltante = "facturas" | "cobros" | "cobros_anteriores" | "egresos";

export type DatosDelInforme = {
  readonly moneda: Moneda;
  readonly periodo: Periodo;
  readonly facturas: readonly Factura[];
  readonly cobros: readonly Cobro[];
  /** Cobros del periodo anterior, para comparar. */
  readonly cobrosAnteriores: readonly Cobro[];
  /** Pagos que salieron en el periodo. Ausente si el sistema no los expone. */
  readonly egresos?: readonly Cobro[];
  readonly egresosAnteriores?: readonly Cobro[];
  readonly hoy: Date;
  /** Lo que quedó a medio leer. */
  readonly faltantes?: readonly Faltante[];
};

export type InformeDelNegocio = {
  readonly moneda: Moneda;
  readonly periodo: Periodo;
  readonly periodoComparado: Periodo;
  readonly caja: EstadoDeCaja;
  readonly entro: Comparacion;
  /** Null cuando el sistema contable no expone lo que salió. */
  readonly salio: Comparacion | null;
  /** Entró menos salió. Null si no se pudo saber lo que salió. */
  readonly diferencia: number | null;
  readonly deudores: readonly DeudorDestacado[];
  readonly faltantes: readonly Faltante[];
  /** El informe escrito, línea a línea, tal y como se le lee al dueño. */
  readonly lineas: readonly string[];
};

function sumaDe(cobros: readonly Cobro[]): number {
  return cobros.reduce((s, c) => s + c.importe.enMonedaBase, 0);
}

/** «12.000 pesos más» / «3.000 pesos menos», nunca «+12%» a secas. */
function diferenciaLegible(c: Comparacion, moneda: Moneda): string {
  if (c.anterior === 0 && c.actual === 0) return "igual que antes: nada";
  if (c.anterior === 0) return "y en el periodo anterior no entró nada";
  if (c.diferencia === 0) return "exactamente lo mismo que en el periodo anterior";
  const cuanto = dinero(Math.abs(c.diferencia), moneda);
  const porcentaje = c.porcentaje === null ? "" : ` (${Math.abs(c.porcentaje)}%)`;
  return c.diferencia > 0
    ? `${cuanto}${porcentaje} más que en el periodo anterior`
    : `${cuanto}${porcentaje} menos que en el periodo anterior`;
}

const TEXTO_FALTANTE: Readonly<Record<Faltante, string>> = {
  facturas: "no pude leer todas tus facturas, así que lo que te deben puede ser más",
  cobros: "no pude leer todos los pagos del periodo, así que lo que entró puede ser más",
  cobros_anteriores: "no pude leer todos los pagos del periodo anterior, así que la comparación es aproximada",
  egresos: "tu sistema de facturación no me deja ver lo que salió, así que no puedo decirte si el saldo del periodo fue a favor o en contra",
};

/**
 * El informe completo: números y el texto que los cuenta.
 *
 * El texto se arma aquí y no en el modelo porque las cifras y las palabras
 * tienen que decir lo mismo siempre. El modelo lo entrega y lo comenta; no lo
 * reescribe ni vuelve a hacer las cuentas.
 */
export function informeDelNegocio(datos: DatosDelInforme): InformeDelNegocio {
  const { moneda, periodo, hoy } = datos;
  const faltantes = [...(datos.faltantes ?? [])];

  const caja = estadoDeCaja({
    facturas: datos.facturas,
    cobros: datos.cobros,
    moneda,
    hoy,
  });

  const entro = comparar(sumaDe(datos.cobros), sumaDe(datos.cobrosAnteriores));
  const salio = datos.egresos
    ? comparar(sumaDe(datos.egresos), sumaDe(datos.egresosAnteriores ?? []))
    : null;
  if (!datos.egresos && !faltantes.includes("egresos")) faltantes.push("egresos");

  const deudores = deudoresDestacados(datos.facturas, hoy, 3);
  const comparado = periodoAnterior(periodo);
  const dias = diasDelPeriodo(periodo);

  const lineas: string[] = [];

  lineas.push(
    `Cómo va el negocio, del ${periodo.desde} al ${periodo.hasta} (${dias} ${dias === 1 ? "día" : "días"}).`,
  );

  lineas.push(
    entro.actual > 0
      ? `Entraron ${dinero(entro.actual, moneda)}: ${diferenciaLegible(entro, moneda)}.`
      : `No entró nada en el periodo, ${diferenciaLegible(entro, moneda)}.`,
  );

  if (salio) {
    lineas.push(`Salieron ${dinero(salio.actual, moneda)}: ${diferenciaLegible(salio, moneda)}.`);
    const diferencia = entro.actual - salio.actual;
    lineas.push(
      diferencia >= 0
        ? `Te quedaron ${dinero(diferencia, moneda)} a favor en el periodo.`
        : `Salió ${dinero(Math.abs(diferencia), moneda)} más de lo que entró.`,
    );
  }

  if (caja.facturasAbiertas === 0) {
    lineas.push("No te debe nadie: todas tus facturas están pagadas.");
  } else {
    lineas.push(
      `Te deben ${dinero(caja.porCobrar, moneda)} en ${caja.facturasAbiertas} ${
        caja.facturasAbiertas === 1 ? "factura" : "facturas"
      }.`,
    );
    if (caja.vencido > 0) {
      lineas.push(
        `De eso, ${dinero(caja.vencido, moneda)} ya están vencidos en ${caja.facturasVencidas} ${
          caja.facturasVencidas === 1 ? "factura" : "facturas"
        }: es lo que hay que perseguir.`,
      );
    } else {
      lineas.push("Ninguna está vencida todavía.");
    }
    if (caja.facturasEstaSemana > 0) {
      lineas.push(
        `La semana que viene vencen ${dinero(caja.venceEstaSemana, moneda)} en ${caja.facturasEstaSemana} ${
          caja.facturasEstaSemana === 1 ? "factura" : "facturas"
        }.`,
      );
    }
  }

  for (const d of deudores) {
    const cuantas = `${d.facturas} ${d.facturas === 1 ? "factura" : "facturas"}`;
    lineas.push(
      d.atrasoMaximo > 0
        ? `${d.cliente} te debe ${dinero(d.total, moneda)} en ${cuantas}, y la más vieja lleva ${d.atrasoMaximo} ${
            d.atrasoMaximo === 1 ? "día" : "días"
          } de atraso.`
        : `${d.cliente} te debe ${dinero(d.total, moneda)} en ${cuantas}, todavía sin vencer.`,
    );
  }

  for (const f of faltantes) lineas.push(`Aviso: ${TEXTO_FALTANTE[f]}.`);

  return {
    moneda,
    periodo,
    periodoComparado: comparado,
    caja,
    entro,
    salio,
    diferencia: salio ? entro.actual - salio.actual : null,
    deudores,
    faltantes,
    lineas,
  };
}

/**
 * Una frase de titular, para abrir el informe.
 *
 * Es lo que el dueño lee si no lee nada más, así que dice lo que le importa:
 * cuánto le deben y qué tan atrasado está.
 */
export function titularDelInforme(informe: InformeDelNegocio): string {
  const { caja, moneda, entro } = informe;
  if (caja.facturasAbiertas === 0) {
    return `Nadie te debe nada y en el periodo entraron ${dinero(entro.actual, moneda)}.`;
  }
  if (caja.vencido > 0) {
    return (
      `Te deben ${dinero(caja.porCobrar, moneda)}, de los cuales ${dinero(caja.vencido, moneda)} ` +
      `están vencidos, y en el periodo entraron ${dinero(entro.actual, moneda)}.`
    );
  }
  return `Te deben ${dinero(caja.porCobrar, moneda)}, nada vencido, y en el periodo entraron ${dinero(entro.actual, moneda)}.`;
}

/** Facturas que vencen dentro de los próximos `dias`, para el aviso de la semana. */
export function venceEnLosProximos(
  facturas: readonly Factura[],
  hoy: Date,
  dias = 7,
): readonly Factura[] {
  return facturas
    .filter((f) => f.estado === "abierta" && f.saldo.enMonedaBase > 0)
    .filter((f) => {
      const atraso = diasDeAtraso(f.vence, hoy);
      return atraso <= 0 && -atraso <= dias;
    })
    .sort((a, b) => a.vence.localeCompare(b.vence));
}
