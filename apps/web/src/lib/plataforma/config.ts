import "server-only";

/**
 * La configuración del panel, vista desde la web.
 *
 * Se lee en cada pantalla (el menú lateral necesita el umbral de aviso), así que
 * se recuerda unos segundos por proceso. Un cambio tarda como mucho eso en llegar
 * a las demás instancias.
 *
 * Cada lectura deja la clave de la cartera en el entorno del proceso, que es
 * donde la buscan el motor y los embeddings. `instrumentation.ts` hace la
 * primera antes de atender ninguna petición.
 */
import {
  aplicarClaveDeCartera,
  leerAjustesDeCobro,
  type AjustesDeCobro,
  type ClaveDeCartera,
} from "@strappy/db/adapters";
import { CONFIG_COBRO_POR_DEFECTO, type ConfigCobro } from "@strappy/core/recargas";
import type { LlavesWompi } from "@strappy/core/wompi";
import { obtenerPool } from "@/lib/db/pool";

const VIGENCIA_MS = 30_000;
let recordado: { valor: AjustesDeCobro; hasta: number } | null = null;

async function ajustes(): Promise<AjustesDeCobro> {
  if (recordado && recordado.hasta > Date.now()) return recordado.valor;
  try {
    const valor = await leerAjustesDeCobro((texto, valores) => obtenerPool().query(texto, valores));
    aplicarClaveDeCartera(valor.cartera);
    recordado = { valor, hasta: Date.now() + VIGENCIA_MS };
    return valor;
  } catch (e) {
    // Antes de aplicar la migración, o con la base caída un instante, el menú de
    // todas las pantallas no puede romperse por esto.
    console.error("[plataforma] no se pudieron leer los ajustes:", e instanceof Error ? e.message : e);
    return {
      config: CONFIG_COBRO_POR_DEFECTO,
      llaves: { publica: "", privada: "", integridad: "", eventos: "" },
      cartera: { openrouter: "", origen: "ninguno" },
    };
  }
}

export async function obtenerConfigCobro(): Promise<ConfigCobro> {
  return (await ajustes()).config;
}

export async function obtenerLlavesWompi(): Promise<LlavesWompi> {
  return (await ajustes()).llaves;
}

export async function obtenerClaveDeCartera(): Promise<ClaveDeCartera> {
  return (await ajustes()).cartera;
}

/** Al arrancar el servidor: que la clave del panel esté puesta antes de la primera petición. */
export async function prepararAjustes(): Promise<void> {
  await ajustes();
}

export function olvidarAjustesRecordados(): void {
  recordado = null;
}
