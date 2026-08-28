import "server-only";

/**
 * «Tu gasto en Meta»: lo que Meta le cobra al cliente por la mensajería.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTO EXISTE Y POR QUÉ VIVE APARTE
 * ════════════════════════════════════════════════════════════════════════════
 * Operamos como Tech Provider de Meta: la WABA es del cliente, su método de
 * pago está en su Meta Business Manager, y META LE COBRA A ÉL DIRECTAMENTE. En
 * `credit_rates` la tarifa `message_out` está a cero por eso mismo, con el
 * porqué escrito al lado.
 *
 * Si no le mostrásemos este bloque, el cliente vería un cargo de Meta en su
 * tarjeta y asumiría que se lo hicimos nosotros. Si lo mostrásemos SUMADO a los
 * créditos, creería que se lo estamos cobrando dos veces. Las dos confusiones
 * cuestan lo mismo: un ticket, y la sospecha de que la factura está inflada.
 *
 * Por eso este módulo:
 *   · devuelve DÓLARES, no créditos;
 *   · lleva su propia marca de origen en el tipo;
 *   · no exporta ninguna función que combine con `analitica.ts`;
 *   · trae el aviso ya redactado, para que ninguna pantalla se lo invente.
 *
 * La fuente es `waba_analytics_daily`, que sincroniza otra corriente leyendo la
 * WABA del cliente con SU token (`packages/whatsapp/src/analytics.ts`). Aquí
 * solo se lee lo ya sincronizado: una pantalla no llama a la API de Meta.
 */
import { conEspacio } from "@/lib/db/pool";
import { AVISO_COBRO_META, DIAS_RECONSOLIDACION } from "@strappy/whatsapp";
import { diaEnZona, sumarDias, type RangoDias } from "./fechas";

/** Marca de origen. Un `GastoEnMeta` no encaja donde se espera consumo nuestro. */
export const ORIGEN_META = "meta" as const;

export type PuntoGastoMeta = {
  readonly dia: string;
  readonly conversaciones: number;
  /** Dólares. NUNCA créditos: esto no pasa por nuestra cartera. */
  readonly costeUsd: number;
  /** Meta corrige las cifras de los últimos días; se marcan como provisionales. */
  readonly provisional: boolean;
};

export type GastoEnMeta = {
  readonly origen: typeof ORIGEN_META;
  readonly rango: RangoDias;
  /** false cuando el espacio aún no tiene WABA conectada. */
  readonly hayDatos: boolean;
  readonly conversaciones: number;
  readonly costeUsd: number;
  readonly costeProvisionalUsd: number;
  readonly porCategoria: readonly { categoria: string; etiqueta: string; conversaciones: number; costeUsd: number }[];
  readonly serie: readonly PuntoGastoMeta[];
  /** Aviso ya redactado. La interfaz lo pinta tal cual, no lo reescribe. */
  readonly aviso: string;
};

export async function gastoEnMeta(
  workspaceId: string,
  rango: RangoDias,
  zona = "America/Bogota",
  ahora = new Date(),
): Promise<GastoEnMeta> {
  const corte = sumarDias(diaEnZona(ahora, zona), -DIAS_RECONSOLIDACION);

  const { serie, categorias } = await conEspacio(workspaceId, async (scope) => {
    const [porDia, porCategoria] = await Promise.all([
      scope.query<{ dia: string; conversaciones: string; coste: string }>(
        `select day::text as dia,
                sum(conversations)::text as conversaciones,
                sum(cost_usd)::text      as coste
           from public.waba_analytics_daily
          where workspace_id = $1 and day between $2::date and $3::date
          group by day
          order by day asc`,
        [workspaceId, rango.desde, rango.hasta],
      ),
      scope.query<{ categoria: string; conversaciones: string; coste: string }>(
        `select conversation_category as categoria,
                sum(conversations)::text as conversaciones,
                sum(cost_usd)::text      as coste
           from public.waba_analytics_daily
          where workspace_id = $1 and day between $2::date and $3::date
          group by conversation_category
          order by sum(cost_usd) desc`,
        [workspaceId, rango.desde, rango.hasta],
      ),
    ]);
    return { serie: porDia.rows, categorias: porCategoria.rows };
  });

  const puntos: PuntoGastoMeta[] = serie.map((f) => ({
    dia: f.dia,
    conversaciones: Number(f.conversaciones),
    costeUsd: Number(f.coste),
    provisional: f.dia > corte,
  }));

  const costeUsd = puntos.reduce((s, p) => s + p.costeUsd, 0);
  const costeProvisionalUsd = puntos.filter((p) => p.provisional).reduce((s, p) => s + p.costeUsd, 0);

  return {
    origen: ORIGEN_META,
    rango,
    hayDatos: puntos.length > 0,
    conversaciones: puntos.reduce((s, p) => s + p.conversaciones, 0),
    costeUsd: redondear(costeUsd),
    costeProvisionalUsd: redondear(costeProvisionalUsd),
    porCategoria: categorias.map((f) => ({
      categoria: f.categoria,
      etiqueta: ETIQUETA_CATEGORIA[f.categoria] ?? f.categoria,
      conversaciones: Number(f.conversaciones),
      costeUsd: redondear(Number(f.coste)),
    })),
    serie: puntos,
    aviso:
      costeProvisionalUsd > 0
        ? `${AVISO_COBRO_META} Los últimos ${DIAS_RECONSOLIDACION} días son provisionales: Meta consolida los costes con retraso.`
        : AVISO_COBRO_META,
  };
}

const ETIQUETA_CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidad",
  AUTHENTICATION: "Autenticación",
  SERVICE: "Servicio",
  "*": "Sin categoría",
};

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
