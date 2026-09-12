/**
 * El criterio del agente: qué va bien, qué va mal y cómo se dice.
 *
 * Módulo puro, sin red y sin modelo. Está aparte porque es lo único que de
 * verdad se puede probar: si «esta campaña va mal» dependiera de lo que el
 * modelo opine ese día, el cliente recibiría un diagnóstico distinto cada
 * lunes con los mismos números.
 *
 * Dos decisiones que no son de estilo:
 *  · Se compara contra la MEDIANA de las campañas del propio cliente, no
 *    contra promedios del sector. Una panadería y un bufete no comparten
 *    referencia, pero las campañas de un mismo negocio sí.
 *  · Nada se juzga sin datos suficientes. Con dos clics no se dice que una
 *    campaña es mala: se dice que todavía no se sabe.
 */
import type { Campana, Metricas, Periodo } from "./ports.js";

/** Gasto mínimo para opinar de una campaña sin resultados, en veces el coste típico. */
const VECES_COSTE_TIPICO_PARA_OPINAR = 2;
/** A partir de aquí, una campaña es «mucho más cara» que la mediana. */
const VECES_MEDIANA_PARA_ALERTAR = 2.5;
/** Clics mínimos para que una campaña sin conversiones sea un hallazgo y no ruido. */
const CLICS_MINIMOS = 30;

export type Severidad = "grave" | "aviso" | "bueno";

export type Hallazgo = {
  readonly campanaId: string;
  readonly campana: string;
  readonly severidad: Severidad;
  /** Frase corta, en lenguaje de negocio. */
  readonly titulo: string;
  /** Explicación con las cifras que la sostienen. */
  readonly detalle: string;
  /** Qué se puede hacer. Nunca se ejecuta solo: se propone. */
  readonly propuesta?: string;
};

export function costePorResultado(m: Metricas): number | null {
  if (m.conversiones <= 0) return null;
  return m.gasto / m.conversiones;
}

export function costePorClic(m: Metricas): number | null {
  if (m.clics <= 0) return null;
  return m.gasto / m.clics;
}

/** Mediana del coste por resultado de las campañas que sí tienen resultados. */
export function costeTipico(campanas: readonly Campana[]): number | null {
  const costes = campanas
    .map((c) => costePorResultado(c.metricas))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (costes.length === 0) return null;
  const medio = Math.floor(costes.length / 2);
  if (costes.length % 2 === 1) return costes[medio] ?? null;
  const izq = costes[medio - 1];
  const der = costes[medio];
  return izq !== undefined && der !== undefined ? (izq + der) / 2 : null;
}

/**
 * Escribe una cantidad como la lee el cliente.
 *
 * En pesos colombianos nadie escribe decimales: «120.000 pesos», no
 * «120.000,00». En dólares sí importan los centavos.
 */
export function dinero(valor: number, moneda: string): string {
  const sinDecimales = ["COP", "CLP", "PYG", "JPY", "KRW", "VND", "ISK"].includes(moneda.toUpperCase());
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda.toUpperCase(),
    minimumFractionDigits: sinDecimales ? 0 : 2,
    maximumFractionDigits: sinDecimales ? 0 : 2,
  }).format(valor);
}

export function porcentaje(parte: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((parte / total) * 100)}%`;
}

/**
 * Qué está pasando con el dinero del cliente.
 *
 * Devuelve hallazgos ordenados por gravedad y, dentro de cada gravedad, por
 * dinero en juego: lo primero que lee el cliente es lo que más le cuesta.
 */
export function analizar(campanas: readonly Campana[], moneda: string): readonly Hallazgo[] {
  const activas = campanas.filter((c) => c.estado === "activa");
  const tipico = costeTipico(campanas);
  const hallazgos: Hallazgo[] = [];

  for (const c of activas) {
    const m = c.metricas;
    const coste = costePorResultado(m);

    // Gasta y no trae nada. Solo se dice cuando hay tráfico suficiente para
    // que la ausencia de resultados signifique algo.
    if (coste === null && m.gasto > 0) {
      const suficiente =
        m.clics >= CLICS_MINIMOS ||
        (tipico !== null && m.gasto >= tipico * VECES_COSTE_TIPICO_PARA_OPINAR);
      if (suficiente) {
        hallazgos.push({
          campanaId: c.id,
          campana: c.nombre,
          severidad: "grave",
          titulo: `«${c.nombre}» está gastando sin traer clientes`,
          detalle: `Lleva ${dinero(m.gasto, moneda)} y ${m.clics} clics en el periodo, y ni un solo resultado.`,
          propuesta: "Puedo pausarla mientras revisas a dónde lleva el anuncio, si me lo apruebas.",
        });
      } else {
        hallazgos.push({
          campanaId: c.id,
          campana: c.nombre,
          severidad: "aviso",
          titulo: `«${c.nombre}» todavía no tiene resultados`,
          detalle: `Lleva ${dinero(m.gasto, moneda)} y ${m.clics} clics: aún son pocos datos para juzgarla.`,
        });
      }
      continue;
    }

    if (coste === null) continue;

    // Mucho más cara que el resto de campañas del mismo negocio.
    if (tipico !== null && coste > tipico * VECES_MEDIANA_PARA_ALERTAR) {
      const veces = (coste / tipico).toFixed(1).replace(".", ",");
      hallazgos.push({
        campanaId: c.id,
        campana: c.nombre,
        severidad: "grave",
        titulo: `Cada cliente de «${c.nombre}» te cuesta ${veces} veces más que el resto`,
        detalle: `Aquí cada resultado sale a ${dinero(coste, moneda)} y en tus otras campañas sale a ${dinero(tipico, moneda)}.`,
        propuesta: "Puedo bajarle el presupuesto y pasárselo a la que mejor va, si me lo apruebas.",
      });
      continue;
    }

    // La que mejor va: también es noticia, y es la que merece más dinero.
    if (tipico !== null && coste <= tipico * 0.6 && m.conversiones > 0) {
      hallazgos.push({
        campanaId: c.id,
        campana: c.nombre,
        severidad: "bueno",
        titulo: `«${c.nombre}» es la que mejor te está funcionando`,
        detalle: `Te trae clientes a ${dinero(coste, moneda)} cada uno, frente a ${dinero(tipico, moneda)} de media.`,
        propuesta: "Si quieres, le subo el presupuesto para que traiga más.",
      });
    }
  }

  const orden: Record<Severidad, number> = { grave: 0, aviso: 1, bueno: 2 };
  return [...hallazgos].sort((a, b) => {
    const porSeveridad = orden[a.severidad] - orden[b.severidad];
    if (porSeveridad !== 0) return porSeveridad;
    const gastoA = campanas.find((c) => c.id === a.campanaId)?.metricas.gasto ?? 0;
    const gastoB = campanas.find((c) => c.id === b.campanaId)?.metricas.gasto ?? 0;
    return gastoB - gastoA;
  });
}

export type ResumenPeriodo = {
  readonly periodo: Periodo;
  readonly moneda: string;
  readonly gasto: number;
  readonly resultados: number;
  readonly costePorResultado: number | null;
  readonly activas: number;
  readonly total: number;
};

export function resumir(campanas: readonly Campana[], periodo: Periodo, moneda: string): ResumenPeriodo {
  const gasto = campanas.reduce((s, c) => s + c.metricas.gasto, 0);
  const resultados = campanas.reduce((s, c) => s + c.metricas.conversiones, 0);
  return {
    periodo,
    moneda,
    gasto,
    resultados,
    costePorResultado: resultados > 0 ? gasto / resultados : null,
    activas: campanas.filter((c) => c.estado === "activa").length,
    total: campanas.length,
  };
}

/** El resumen dicho como se lo cuenta un empleado al dueño, sin jerga. */
export function frasePeriodo(r: ResumenPeriodo): string {
  const invertido = `Entre el ${r.periodo.desde} y el ${r.periodo.hasta} invertiste ${dinero(r.gasto, r.moneda)}`;
  if (r.resultados === 0) {
    return `${invertido} y todavía no hay resultados registrados.`;
  }
  const cada = r.costePorResultado === null ? "" : `, es decir ${dinero(r.costePorResultado, r.moneda)} por cada uno`;
  return `${invertido} y conseguiste ${r.resultados} ${r.resultados === 1 ? "resultado" : "resultados"}${cada}.`;
}

/**
 * Cuánto cambia el dinero del cliente una propuesta de presupuesto.
 *
 * La aprobación tiene que decir esto en pesos al mes, no en porcentajes: «de
 * 30.000 a 50.000 al día» no le dice a nadie que son 600.000 pesos más al mes.
 */
export function impactoMensual(anterior: number, nuevo: number, moneda: string): string {
  const diferencia = (nuevo - anterior) * 30;
  const signo = diferencia >= 0 ? "más" : "menos";
  return (
    `De ${dinero(anterior, moneda)} a ${dinero(nuevo, moneda)} al día: ` +
    `unos ${dinero(Math.abs(diferencia), moneda)} ${signo} al mes.`
  );
}
