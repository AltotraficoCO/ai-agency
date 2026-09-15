/**
 * Los adaptadores reales de las plataformas de anuncios.
 *
 * Se exportan por `@strappy/marketing/adaptadores` y no por el índice del
 * paquete a propósito: el agente, sus herramientas y sus tests no deben poder
 * importar por accidente nada que sepa de HTTP. Quien los usa es el worker (los
 * construye con las credenciales descifradas) y la web (para probar una
 * conexión recién hecha antes de guardarla).
 */
export * from "./http.js";
export * from "./google.js";
export * from "./meta.js";
export * from "./tiktok.js";
export * from "./oauth.js";

import type { AdsPort, Plataforma } from "../ports.js";
import type { OpcionesAds } from "./http.js";
import { crearAdsGoogle, type CredencialesGoogleAds } from "./google.js";
import { crearAdsMeta, type CredencialesMetaAds } from "./meta.js";
import { crearAdsTiktok, type CredencialesTiktokAds } from "./tiktok.js";

/** Las credenciales de cada plataforma, etiquetadas por la plataforma. */
export type CredencialesAds =
  | { readonly plataforma: "google_ads"; readonly creds: CredencialesGoogleAds }
  | { readonly plataforma: "meta_ads"; readonly creds: CredencialesMetaAds }
  | { readonly plataforma: "tiktok_ads"; readonly creds: CredencialesTiktokAds };

/**
 * El adaptador que corresponde a unas credenciales.
 *
 * Existe para que quien conecta las plataformas —el worker— no tenga un
 * `switch` propio que haya que acordarse de ampliar con la cuarta plataforma.
 */
export function crearAds(entrada: CredencialesAds, o: OpcionesAds = {}): AdsPort {
  switch (entrada.plataforma) {
    case "google_ads":
      return crearAdsGoogle(entrada.creds, o);
    case "meta_ads":
      return crearAdsMeta(entrada.creds, o);
    case "tiktok_ads":
      return crearAdsTiktok(entrada.creds, o);
  }
}

/** Qué plataformas sabe construir este módulo. Útil para validar lo que llega de la base. */
export const PLATAFORMAS_CON_ADAPTADOR: readonly Plataforma[] = ["google_ads", "meta_ads", "tiktok_ads"];
