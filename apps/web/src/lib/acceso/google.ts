import "server-only";

/**
 * «Continuar con Google» con la app de Strappy, no con la de Supabase.
 *
 * Con `signInWithOAuth` de Supabase, Google enseñaba «ir a
 * witlvqvwbgixlewzdbfe.supabase.co» en la pantalla de acceso: la URL de
 * retorno era la de Supabase. Aquí el permiso lo pide Strappy con su propio
 * cliente OAuth y su propio retorno en strappy.io, y Supabase solo recibe el
 * `id_token` ya emitido por Google para crear la sesión
 * (`signInWithIdToken`). El cliente sigue siendo Supabase; la cara es la de
 * Strappy.
 *
 * El `state` va cifrado con la clave de la web y lleva a dónde volver, el
 * nonce en claro y la caducidad. A Google se le manda el nonce HASHEADO y a
 * Supabase el nonce en claro: Supabase lo hashea y lo compara con el del
 * token, que es lo que impide reutilizar un id_token ajeno.
 */
import { createHash, randomBytes } from "node:crypto";
import { cifrar, descifrar, leerClave } from "@strappy/db";

const VIGENCIA_MS = 10 * 60_000;
const PERMISOS = ["openid", "email", "profile"];

export const RUTA_INICIO = "/api/auth/google/inicio";
export const RUTA_RETORNO = "/api/auth/google/retorno";

export type AppGoogle = { readonly clientId: string; readonly clientSecret: string };

/** El cliente OAuth de Strappy. Es el mismo que usa Google Ads: una sola app. */
export function appGoogle(): AppGoogle | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_ADS_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function clave(): Buffer {
  return leerClave(process.env.ENCRYPTION_KEY);
}

/** Solo rutas internas: un `siguiente` con dominio sería un redirector abierto. */
export function destinoSeguro(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//")) return "/";
  return valor;
}

export function urlDeAcceso(input: { app: AppGoogle; origen: string; siguiente: string }): string {
  const nonce = randomBytes(16).toString("hex");
  const state = cifrar(
    JSON.stringify({ s: destinoSeguro(input.siguiente), n: nonce, exp: Date.now() + VIGENCIA_MS }),
    clave(),
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.app.clientId);
  url.searchParams.set("redirect_uri", new URL(RUTA_RETORNO, input.origen).toString());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PERMISOS.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", createHash("sha256").update(nonce).digest("hex"));
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function leerEstado(state: string): { siguiente: string; nonce: string } | null {
  try {
    const datos = JSON.parse(descifrar(state, clave())) as Record<string, unknown>;
    const { s, n, exp } = datos;
    if (typeof n !== "string" || typeof exp !== "number" || exp < Date.now()) return null;
    return { siguiente: destinoSeguro(typeof s === "string" ? s : "/"), nonce: n };
  } catch {
    return null;
  }
}

/** Cambia el código por el `id_token` de Google. */
export async function canjearCodigo(input: { app: AppGoogle; code: string; origen: string }): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.app.clientId,
      client_secret: input.app.clientSecret,
      code: input.code,
      redirect_uri: new URL(RUTA_RETORNO, input.origen).toString(),
      grant_type: "authorization_code",
    }).toString(),
  });
  const datos = (await res.json().catch(() => null)) as { id_token?: unknown; error_description?: unknown } | null;
  if (!res.ok || typeof datos?.id_token !== "string") {
    const motivo = typeof datos?.error_description === "string" ? datos.error_description : `Google respondió ${res.status}`;
    throw new Error(`Google no completó el acceso: ${motivo}`);
  }
  return datos.id_token;
}
