/**
 * El transporte: autenticación, timeouts, errores y la API propia del plugin
 * conector.
 */
import type { WpCreds } from "../../ports.js";

export type Fetch = typeof globalThis.fetch;

export type WpClientOptions = {
  readonly fetch?: Fetch;
  readonly abortSignal?: AbortSignal;
};

export function baseUrl(c: WpCreds): string {
  const u = c.url.replace(/\/+$/, "");
  return u.startsWith("http") ? u : `https://${u}`;
}

export function authHeader(c: WpCreds): string {
  return `Basic ${Buffer.from(`${c.user}:${c.appPassword}`).toString("base64")}`;
}

/** Une la señal externa (timeout duro de la tarea) con la del propio timeout. */
export function señal(timeoutMs: number, externa?: AbortSignal): AbortSignal {
  const propia = AbortSignal.timeout(timeoutMs);
  return externa ? AbortSignal.any([propia, externa]) : propia;
}

export class WpError extends Error {
  constructor(
    readonly status: number,
    readonly cuerpo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "WpError";
  }
}

export async function wp(
  c: WpCreds,
  o: WpClientOptions,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const f = o.fetch ?? globalThis.fetch;
  return f(`${baseUrl(c)}/wp-json${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(c),
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: señal(timeoutMs, o.abortSignal),
  });
}

export async function exigirOk(res: Response, contexto: string): Promise<unknown> {
  if (res.ok) return res.status === 204 ? null : await res.json();
  const cuerpo = (await res.text()).slice(0, 300);
  throw new WpError(res.status, cuerpo, `${contexto} (${res.status}): ${cuerpo}`);
}

export async function conectorApi(
  c: WpCreds,
  o: WpClientOptions,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown> | null> {
  const f = o.fetch ?? globalThis.fetch;
  try {
    const res = await f(`${baseUrl(c)}/wp-json/strappy/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: authHeader(c), "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: señal(30_000, o.abortSignal),
    });
    if (res.status === 404) return null; // el plugin conector no está instalado
    if (!res.ok) {
      throw new WpError(
        res.status,
        "",
        `strappy/v1${path} (${res.status}): ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    // Solo se propaga el fallo del propio conector; que no exista es normal.
    if (e instanceof WpError) throw e;
    return null;
  }
}
