/**
 * Cuándo le toca trabajar a un agente.
 *
 * El cliente no escribe `0 8 * * 1`. Dice «cada mañana», «todos los lunes» o
 * «el día 1», y eso es lo que se guarda: una cadencia declarativa con su hora y
 * su zona horaria. De ahí sale la próxima ejecución.
 *
 * Tres decisiones que no son de estilo:
 *
 *  - **La hora es la del cliente, no la del servidor.** «Cada lunes a las 8»
 *    significa las 8 de su reloj. El worker vive en UTC y el cliente en Bogotá;
 *    sin la zona, el informe del lunes llegaría de madrugada.
 *  - **Nunca se acumulan ejecuciones.** La próxima se calcula desde AHORA, no
 *    sumando el intervalo a la anterior. Si el worker estuvo apagado tres días,
 *    al volver hay una ejecución pendiente, no tres.
 *  - **Lo atrasado caduca.** Un informe del lunes entregado el miércoles es
 *    peor que no entregarlo: pasada la tolerancia, esa ejecución se salta y se
 *    programa la siguiente (`decidirEjecucion`).
 *
 * Sin dependencias: el desplazamiento de la zona se saca de `Intl`, que ya
 * conoce los cambios de horario de verano de cada país.
 */

export type Frecuencia = "diaria" | "semanal" | "mensual";

export type Cadencia = {
  readonly frecuencia: Frecuencia;
  /** 0-23, en la zona del cliente. */
  readonly hora: number;
  /** 0-59. */
  readonly minuto: number;
  /** Solo `semanal`. 1 = lunes … 7 = domingo, como se numeran los días en la calle. */
  readonly diaSemana?: number | undefined;
  /**
   * Solo `mensual`. 1-28: el 29, el 30 y el 31 no existen todos los meses, y un
   * «cada día 31» que se salta febrero no es lo que nadie quiere decir.
   */
  readonly diaMes?: number | undefined;
  /** IANA, p. ej. `America/Bogota`. */
  readonly zona: string;
};

/** Partes de un instante, leídas en una zona concreta. */
type Partes = {
  año: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
  /** 1 = lunes … 7 = domingo. */
  diaSemana: number;
};

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;

function formateador(zona: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
}

/** Comprueba que la zona existe. `Intl` lanza si no. */
export function esZonaValida(zona: string): boolean {
  try {
    formateador(zona);
    return true;
  } catch {
    return false;
  }
}

function partesEn(instante: Date, zona: string): Partes {
  const p = formateador(zona).formatToParts(instante);
  const leer = (tipo: string): string => p.find((x) => x.type === tipo)?.value ?? "0";
  const semana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(leer("weekday"));
  return {
    año: Number(leer("year")),
    mes: Number(leer("month")),
    dia: Number(leer("day")),
    // A medianoche, `hour12: false` da «24» en algunos entornos.
    hora: Number(leer("hour")) % 24,
    minuto: Number(leer("minute")),
    segundo: Number(leer("second")),
    diaSemana: semana <= 0 ? 7 : semana,
  };
}

/**
 * El desplazamiento de la zona en ese instante, en minutos.
 *
 * Se mide comparando la hora local con la UTC del MISMO instante, así que sale
 * bien tanto en Bogotá (siempre −5) como en Madrid o Santiago, que cambian dos
 * veces al año.
 */
function desplazamientoMin(instante: Date, zona: string): number {
  const l = partesEn(instante, zona);
  const comoUtc = Date.UTC(l.año, l.mes - 1, l.dia, l.hora, l.minuto, l.segundo);
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/**
 * El instante UTC de una fecha y hora dadas EN una zona.
 *
 * Se resuelve en dos pasos porque el desplazamiento depende del propio instante
 * que se busca: se estima con el desplazamiento aproximado y se corrige. Es lo
 * que hace que funcione la madrugada del cambio de hora.
 */
function instanteDe(
  zona: string,
  fecha: { año: number; mes: number; dia: number; hora: number; minuto: number },
): Date {
  const comoUtc = Date.UTC(fecha.año, fecha.mes - 1, fecha.dia, fecha.hora, fecha.minuto, 0);
  let instante = new Date(comoUtc);
  for (let i = 0; i < 2; i++) {
    const desp = desplazamientoMin(instante, zona);
    const corregido = new Date(comoUtc - desp * 60000);
    if (corregido.getTime() === instante.getTime()) break;
    instante = corregido;
  }
  return instante;
}

function diasDelMes(año: number, mes: number): number {
  return new Date(Date.UTC(año, mes, 0)).getUTCDate();
}

/**
 * La primera vez que toca a partir de `desde` (excluido).
 *
 * Se prueban candidatos día a día en la zona del cliente en vez de sumar
 * milisegundos: sumar 24 horas se desfasa una hora el día del cambio horario, y
 * «cada mañana a las 8» pasaría a ser a las 7.
 */
export function proximaEjecucion(desde: Date, c: Cadencia): Date {
  const hoy = partesEn(desde, c.zona);
  const limite = c.frecuencia === "mensual" ? 400 : 60;

  for (let salto = 0; salto <= limite; salto++) {
    const base = new Date(Date.UTC(hoy.año, hoy.mes - 1, hoy.dia + salto));
    const año = base.getUTCFullYear();
    const mes = base.getUTCMonth() + 1;
    const dia = base.getUTCDate();

    if (c.frecuencia === "semanal") {
      const diaSemana = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
      if (diaSemana !== (c.diaSemana ?? 1)) continue;
    }
    if (c.frecuencia === "mensual") {
      const pedido = Math.min(c.diaMes ?? 1, diasDelMes(año, mes));
      if (dia !== pedido) continue;
    }

    const candidato = instanteDe(c.zona, { año, mes, dia, hora: c.hora, minuto: c.minuto });
    if (candidato.getTime() > desde.getTime()) return candidato;
  }

  // Inalcanzable con los límites de arriba, pero no se devuelve una fecha
  // inventada: quien llame prefiere un error a programar algo para nunca.
  throw new Error(`No pude calcular la próxima ejecución de una cadencia ${c.frecuencia}.`);
}

/**
 * Cuánto se tolera llegar tarde antes de saltarse la ejecución.
 *
 * Proporcional a la frecuencia: el repaso de la mañana no sirve por la noche,
 * pero el informe del lunes sigue valiendo el lunes por la tarde.
 */
export function toleranciaMs(frecuencia: Frecuencia): number {
  const hora = 60 * 60 * 1000;
  if (frecuencia === "diaria") return 6 * hora;
  if (frecuencia === "semanal") return 24 * hora;
  return 48 * hora;
}

export type DecisionEjecucion =
  | { readonly ejecutar: true; readonly proxima: Date }
  | { readonly ejecutar: false; readonly motivo: "tarde"; readonly proxima: Date };

/**
 * Qué hacer con una ejecución que vencía en `prevista`.
 *
 * Ejecutar si se llega a tiempo; saltarla si el retraso pasó de la tolerancia.
 * En los dos casos se devuelve la próxima, calculada desde ahora: así un worker
 * que estuvo apagado el fin de semana no dispara tres informes seguidos.
 */
export function decidirEjecucion(prevista: Date, ahora: Date, c: Cadencia): DecisionEjecucion {
  const proxima = proximaEjecucion(ahora, c);
  const retraso = ahora.getTime() - prevista.getTime();
  if (retraso > toleranciaMs(c.frecuencia)) return { ejecutar: false, motivo: "tarde", proxima };
  return { ejecutar: true, proxima };
}

/** «cada mañana a las 8:00», «los lunes a las 8:00», «el día 1 a las 9:30». */
export function describirCadencia(c: Cadencia): string {
  const hora = `${String(c.hora).padStart(2, "0")}:${String(c.minuto).padStart(2, "0")}`;
  if (c.frecuencia === "diaria") return `todos los días a las ${hora}`;
  if (c.frecuencia === "semanal") {
    const nombres = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
    return `los ${nombres[c.diaSemana ?? 1]} a las ${hora}`;
  }
  return `el día ${c.diaMes ?? 1} de cada mes a las ${hora}`;
}

/** Cuántas veces al mes se ejecuta, para poder decirle al cliente lo que va a gastar. */
export function vecesAlMes(frecuencia: Frecuencia): number {
  if (frecuencia === "diaria") return 30;
  if (frecuencia === "semanal") return 4;
  return 1;
}

export { DIAS as NOMBRES_DIA_CORTOS };
