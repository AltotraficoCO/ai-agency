/**
 * El permiso del cliente: pedirlo y canjearlo.
 *
 * Vive en el paquete y no en la web por la misma razón que el registro de
 * WhatsApp vive en `@strappy/whatsapp`: aquí no hay Next, ni Postgres, ni
 * sesión. Lo que la web pone encima es dónde se guarda y de quién es.
 *
 * Las tres plataformas hacen lo mismo con tres formas distintas y una sola
 * diferencia que importa de verdad:
 *
 *  · Google devuelve un `refresh_token` —y SOLO la primera vez que el cliente
 *    concede el permiso—. Por eso se pide siempre con `prompt=consent`: sin él,
 *    reconectar una cuenta ya conectada devuelve un permiso sin refresco y la
 *    conexión se queda muerta en una hora, cuando caduca el token de acceso.
 *  · Meta devuelve un token de dos horas que hay que cambiar por uno de sesenta
 *    días en una segunda llamada. Guardar el primero es una conexión que falla
 *    esa misma tarde.
 *  · TikTok devuelve un token que no caduca, dentro de un `data` y con su `code`
 *    propio —que puede ser un error con un HTTP 200—.
 */
import { AdsApiError, numero, pedirJson, texto, type OpcionesAds } from "./http.js";
import type { CredencialesGoogleAds } from "./google.js";
import type { CredencialesMetaAds } from "./meta.js";
import type { CredencialesTiktokAds } from "./tiktok.js";

/** Lo mínimo para hablar de anuncios: leer y gestionar. */
export const PERMISOS_GOOGLE = ["https://www.googleapis.com/auth/adwords"] as const;
export const PERMISOS_META = ["ads_read", "ads_management", "business_management"] as const;

export type AppGoogle = { readonly clientId: string; readonly clientSecret: string };
export type AppMeta = { readonly appId: string; readonly appSecret: string; readonly version?: string };
export type AppTiktok = { readonly appId: string; readonly secret: string };

const VERSION_META = "v21.0";
const VERSION_TIKTOK = "v1.3";

// ---------------------------------------------------------------------------
// A dónde mandar al cliente
// ---------------------------------------------------------------------------

export function urlPermisoGoogle(input: { app: AppGoogle; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.app.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PERMISOS_GOOGLE.join(" "));
  // Sin estos dos no hay `refresh_token` y la conexión dura una hora.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function urlPermisoMeta(input: { app: AppMeta; redirectUri: string; state: string }): string {
  const url = new URL(`https://www.facebook.com/${input.app.version ?? VERSION_META}/dialog/oauth`);
  url.searchParams.set("client_id", input.app.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PERMISOS_META.join(","));
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function urlPermisoTiktok(input: { app: AppTiktok; redirectUri: string; state: string }): string {
  const url = new URL("https://business-api.tiktok.com/portal/auth");
  url.searchParams.set("app_id", input.app.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Canjear el código por credenciales que se puedan guardar
// ---------------------------------------------------------------------------

export async function canjearGoogle(
  input: { app: AppGoogle; code: string; redirectUri: string; developerToken: string; loginCustomerId?: string },
  o: OpcionesAds = {},
): Promise<CredencialesGoogleAds> {
  const datos = (await pedirJson("Google Ads", "completar la conexión", o, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.app.clientId,
      client_secret: input.app.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  })) as { refresh_token?: unknown } | null;

  const refreshToken = texto(datos?.refresh_token);
  if (!refreshToken) {
    throw new AdsApiError(
      "Google Ads",
      0,
      "",
      "Google no devolvió un permiso duradero. Suele pasar cuando la cuenta ya había autorizado la app: quítale el acceso en myaccount.google.com/permissions y vuelve a conectar.",
    );
  }
  return {
    clientId: input.app.clientId,
    clientSecret: input.app.clientSecret,
    refreshToken,
    developerToken: input.developerToken,
    ...(input.loginCustomerId ? { loginCustomerId: input.loginCustomerId } : {}),
  };
}

export async function canjearMeta(
  input: { app: AppMeta; code: string; redirectUri: string },
  o: OpcionesAds = {},
): Promise<CredencialesMetaAds> {
  const version = input.app.version ?? VERSION_META;
  const corto = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  corto.searchParams.set("client_id", input.app.appId);
  corto.searchParams.set("client_secret", input.app.appSecret);
  corto.searchParams.set("redirect_uri", input.redirectUri);
  corto.searchParams.set("code", input.code);

  const primero = (await pedirJson("Meta", "completar la conexión", o, corto.toString(), {
    method: "GET",
  })) as { access_token?: unknown } | null;
  const tokenCorto = texto(primero?.access_token);
  if (!tokenCorto) {
    throw new AdsApiError("Meta", 0, "", "Meta no devolvió un token de acceso.");
  }

  // El de arriba dura dos horas. Este dura sesenta días.
  const largo = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  largo.searchParams.set("grant_type", "fb_exchange_token");
  largo.searchParams.set("client_id", input.app.appId);
  largo.searchParams.set("client_secret", input.app.appSecret);
  largo.searchParams.set("fb_exchange_token", tokenCorto);

  const segundo = (await pedirJson("Meta", "alargar el permiso", o, largo.toString(), {
    method: "GET",
  })) as { access_token?: unknown; expires_in?: unknown } | null;

  const accessToken = texto(segundo?.access_token, tokenCorto);
  const segundos = numero(segundo?.expires_in);
  return {
    accessToken,
    ...(segundos > 0 ? { expiraEn: new Date(Date.now() + segundos * 1000).toISOString() } : {}),
  };
}

export async function canjearTiktok(
  input: { app: AppTiktok; code: string },
  o: OpcionesAds = {},
): Promise<CredencialesTiktokAds> {
  const cuerpo = (await pedirJson(
    "TikTok",
    "completar la conexión",
    o,
    `https://business-api.tiktok.com/open_api/${VERSION_TIKTOK}/oauth2/access_token/`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: input.app.appId, secret: input.app.secret, auth_code: input.code }),
    },
  )) as { code?: unknown; message?: unknown; data?: { access_token?: unknown } } | null;

  // TikTok contesta 200 con un `code` distinto de cero cuando falla.
  const code = numero(cuerpo?.code);
  if (code !== 0) {
    const mensaje = texto(cuerpo?.message, "sin detalle");
    throw new AdsApiError("TikTok", code, mensaje, `TikTok rechazó la conexión (${code}): ${mensaje}`);
  }
  const accessToken = texto(cuerpo?.data?.access_token);
  if (!accessToken) {
    throw new AdsApiError("TikTok", 0, "", "TikTok no devolvió un token de acceso.");
  }
  return { accessToken, appId: input.app.appId, secret: input.app.secret };
}
