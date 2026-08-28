"use client";

/**
 * Fechas y horas de la bandeja, en español de Colombia.
 *
 * Todo pasa por `Intl`: escribir «hace 5 min» a mano funciona hasta que alguien
 * abre la aplicación en otro huso y ve mensajes del futuro.
 */

const HORA_CORTA = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
const DIA_LARGO = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" });
const DIA_CORTO = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });
const FECHA_COMPLETA = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DIA_MS = 86_400_000;

export function hora(valor: string | Date): string {
  return HORA_CORTA.format(new Date(valor));
}

export function fechaCompleta(valor: string | Date): string {
  return FECHA_COMPLETA.format(new Date(valor));
}

const SOLO_FECHA = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Solo el día, sin hora: para «cliente desde el …». */
export function soloFecha(valor: string | Date): string {
  return SOLO_FECHA.format(new Date(valor));
}

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Separador de día del hilo: «Hoy», «Ayer» o el día escrito. */
export function tituloDeDia(valor: string | Date, ahora: Date = new Date()): string {
  const fecha = new Date(valor);
  if (mismoDia(fecha, ahora)) return "Hoy";
  if (mismoDia(fecha, new Date(ahora.getTime() - DIA_MS))) return "Ayer";
  const texto = DIA_LARGO.format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function claveDeDia(valor: string | Date): string {
  const fecha = new Date(valor);
  return `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
}

/**
 * La hora de la lista: si es de hoy, la hora; si no, el día.
 * Nunca «hace 3 días»: en una lista de cincuenta filas, lo relativo obliga a
 * hacer cuentas para comparar dos filas entre sí.
 */
export function horaDeLista(valor: string | null, ahora: Date = new Date()): string {
  if (!valor) return "";
  const fecha = new Date(valor);
  if (mismoDia(fecha, ahora)) return HORA_CORTA.format(fecha);
  if (mismoDia(fecha, new Date(ahora.getTime() - DIA_MS))) return "Ayer";
  return DIA_CORTO.format(fecha).replace(".", "");
}

/** Cuánto lleva esperando, para el aviso de acuerdo de servicio. */
export function esperaLegible(desde: string, ahora: Date = new Date()): string {
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(desde).getTime()) / 60_000));
  if (minutos < 60) return `${minutos} min sin responder`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h sin responder`;
  const dias = Math.floor(horas / 24);
  return `${dias} d sin responder`;
}

/**
 * Cuenta atrás de la ventana de envío.
 *
 * Cuánto queda es aritmética sobre el instante que da el canal; QUÉ significa
 * ese instante lo dice el canal y aquí no se interpreta.
 */
export function cuentaAtras(hasta: string, ahora: Date = new Date()): { texto: string; minutos: number } {
  const minutos = Math.round((new Date(hasta).getTime() - ahora.getTime()) / 60_000);
  if (minutos <= 0) return { texto: "cerrada", minutos: 0 };
  if (minutos < 60) return { texto: `${minutos} min`, minutos };
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return { texto: resto ? `${horas} h ${resto} min` : `${horas} h`, minutos };
}

/** «Mañana a las 9:00» y compañía, para el menú de posponer. */
export function instanteRelativo(horas: number, ahora: Date = new Date()): string {
  return new Date(ahora.getTime() + horas * 3_600_000).toISOString();
}

export function mananaALas(hora9 = 9, ahora: Date = new Date()): string {
  const manana = new Date(ahora);
  manana.setDate(manana.getDate() + 1);
  manana.setHours(hora9, 0, 0, 0);
  return manana.toISOString();
}
