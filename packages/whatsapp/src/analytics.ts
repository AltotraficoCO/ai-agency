/**
 * Analíticas de la WABA: «Tu gasto en Meta».
 *
 * POR QUÉ ESTE MÓDULO EXISTE
 * --------------------------
 * Operamos como Tech Provider: la WABA es del cliente, el método de pago es
 * del cliente y Meta le cobra a él directamente. Sin este bloque, el cliente
 * ve un cargo de Meta en su tarjeta y asume que se lo hicimos nosotros. Por
 * eso leemos su gasto CON SU PROPIO TOKEN y lo mostramos junto a nuestra
 * factura, separado y etiquetado.
 *
 * VENTANA DE 3 DÍAS HACIA ATRÁS
 * -----------------------------
 * Meta consolida los costes con retraso: los datos de las últimas ~72 horas
 * cambian después de publicarse. Si guardásemos el último día como definitivo,
 * la cifra bajaría o subiría sola al día siguiente y el cliente vería que
 * "cambiamos" su gasto. Se relee siempre la ventana de reconsolidación.
 */
import type { ClienteWhatsApp } from "./client.js";
import type { ConversationAnalyticsRaw } from "./types.js";

/** Días que Meta puede seguir corrigiendo. Se releen SIEMPRE. */
export const DIAS_RECONSOLIDACION = 3;

export type PuntoGasto = {
  /** Inicio del intervalo. */
  desde: Date;
  hasta: Date;
  /** Número de conversaciones facturables en el intervalo. */
  conversaciones: number;
  /** Coste en la moneda de la WABA. Meta lo devuelve ya en unidades, no en céntimos. */
  coste: number;
  categoria?: string;
  tipo?: string;
  pais?: string;
  phoneNumber?: string;
  /** Los puntos dentro de la ventana de reconsolidación aún pueden cambiar. */
  provisional: boolean;
};

export type ResumenGasto = {
  desde: Date;
  hasta: Date;
  conversaciones: number;
  costeTotal: number;
  /** Parte del total que Meta todavía puede corregir. */
  costeProvisional: number;
  porCategoria: { categoria: string; conversaciones: number; coste: number }[];
  puntos: PuntoGasto[];
  /** Texto ya redactado para la interfaz. Aquí se decide el encuadre, no en la UI. */
  aviso: string;
};

export const AVISO_COBRO_META =
  "Este importe lo cobra Meta directamente a tu método de pago de WhatsApp Business, no forma parte de tu factura con nosotros.";

export type OpcionesGasto = {
  wabaId: string;
  /** Por defecto, los últimos 30 días. */
  dias?: number;
  granularidad?: "HALF_HOUR" | "DAILY" | "MONTHLY";
  phoneNumbers?: string[];
  /** Dimensiones extra; `CONVERSATION_CATEGORY` viene de serie. */
  dimensiones?: string[];
  now?: () => Date;
};

/**
 * Lee `conversation_analytics` con el token DEL CLIENTE (el que trae el
 * cliente inyectado). Nunca con un token nuestro: la WABA no es nuestra y
 * Meta devolvería 200 con permisos insuficientes.
 */
export async function leerGastoEnMeta(
  api: ClienteWhatsApp,
  opciones: OpcionesGasto,
): Promise<ResumenGasto> {
  const now = opciones.now ?? (() => new Date());
  const ahora = now();
  const dias = opciones.dias ?? 30;

  const hasta = ahora;
  const desde = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);

  const crudo = await api.analiticaConversaciones({
    wabaId: opciones.wabaId,
    desde: Math.floor(desde.getTime() / 1000),
    hasta: Math.floor(hasta.getTime() / 1000),
    granularidad: opciones.granularidad ?? "DAILY",
    ...(opciones.phoneNumbers?.length ? { phoneNumbers: opciones.phoneNumbers } : {}),
    dimensiones: opciones.dimensiones ?? ["CONVERSATION_CATEGORY", "CONVERSATION_TYPE"],
  });

  return resumirGasto(crudo, { desde, hasta, ahora });
}

/** Instante a partir del cual las cifras aún pueden moverse. */
export function inicioDeReconsolidacion(ahora: Date): Date {
  return new Date(ahora.getTime() - DIAS_RECONSOLIDACION * 24 * 60 * 60 * 1000);
}

/** Convierte la respuesta cruda en un resumen listo para pintar. Pura y comprobable. */
export function resumirGasto(
  crudo: ConversationAnalyticsRaw,
  ventana: { desde: Date; hasta: Date; ahora: Date },
): ResumenGasto {
  const corte = inicioDeReconsolidacion(ventana.ahora);
  const puntos: PuntoGasto[] = [];

  for (const bloque of crudo.conversation_analytics?.data ?? []) {
    for (const p of bloque.data_points ?? []) {
      const desde = new Date((p.start ?? 0) * 1000);
      const hasta = new Date((p.end ?? p.start ?? 0) * 1000);
      puntos.push({
        desde,
        hasta,
        conversaciones: p.conversation ?? 0,
        coste: p.cost ?? 0,
        ...(p.conversation_category ? { categoria: p.conversation_category } : {}),
        ...(p.conversation_type ? { tipo: p.conversation_type } : {}),
        ...(p.country ? { pais: p.country } : {}),
        ...(p.phone_number ? { phoneNumber: p.phone_number } : {}),
        // Un punto que TERMINA justo en el corte ya está consolidado.
        provisional: hasta.getTime() > corte.getTime(),
      });
    }
  }

  const porCategoria = new Map<string, { conversaciones: number; coste: number }>();
  let conversaciones = 0;
  let costeTotal = 0;
  let costeProvisional = 0;

  for (const p of puntos) {
    conversaciones += p.conversaciones;
    costeTotal += p.coste;
    if (p.provisional) costeProvisional += p.coste;
    const clave = p.categoria ?? "SIN_CATEGORIA";
    const acumulado = porCategoria.get(clave) ?? { conversaciones: 0, coste: 0 };
    acumulado.conversaciones += p.conversaciones;
    acumulado.coste += p.coste;
    porCategoria.set(clave, acumulado);
  }

  return {
    desde: ventana.desde,
    hasta: ventana.hasta,
    conversaciones,
    costeTotal: redondear(costeTotal),
    costeProvisional: redondear(costeProvisional),
    porCategoria: [...porCategoria.entries()]
      .map(([categoria, v]) => ({ categoria, conversaciones: v.conversaciones, coste: redondear(v.coste) }))
      .sort((a, b) => b.coste - a.coste),
    puntos: puntos.sort((a, b) => a.desde.getTime() - b.desde.getTime()),
    aviso:
      costeProvisional > 0
        ? `${AVISO_COBRO_META} Los últimos ${DIAS_RECONSOLIDACION} días son provisionales: Meta consolida los costes con retraso y la cifra puede ajustarse.`
        : AVISO_COBRO_META,
  };
}

/** Los importes de Meta llegan con muchos decimales; se redondean a céntimos. */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Rango que hay que releer en cada sincronización: desde el último punto
 * consolidado, nunca desde "lo que ya guardamos". Releer barato evita mostrar
 * cifras que luego cambian solas.
 */
export function rangoASincronizar(input: {
  ultimaSincronizacion: Date | null;
  ahora: Date;
  diasMaximos?: number;
}): { desde: Date; hasta: Date } {
  const diasMaximos = input.diasMaximos ?? 30;
  const minimo = new Date(input.ahora.getTime() - diasMaximos * 24 * 60 * 60 * 1000);
  const desdeReconsolidacion = inicioDeReconsolidacion(input.ahora);
  const candidato = input.ultimaSincronizacion
    ? new Date(Math.min(input.ultimaSincronizacion.getTime(), desdeReconsolidacion.getTime()))
    : minimo;
  return {
    desde: new Date(Math.max(candidato.getTime(), minimo.getTime())),
    hasta: input.ahora,
  };
}
