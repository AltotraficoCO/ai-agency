/**
 * Driver del contrato estándar del conector (sitios propios, no WordPress).
 *
 * Portado del proyecto anterior. Se conserva `redirect: "manual"` porque es un
 * fallo real que costó tiempo: al seguir una redirección de origen distinto
 * (sin www → www) `fetch` descarta la cabecera Authorization y el sitio
 * responde un 401 que parece un token malo y no lo es.
 */
import type { ConectorCreds } from "../ports.js";

export type { ConectorCreds };

type Fetch = typeof globalThis.fetch;

export type ConectorOptions = {
  readonly fetch?: Fetch;
  readonly abortSignal?: AbortSignal;
};

export type Bloque = { id: string; tipo: string; props: Record<string, unknown> };
export type PaginaResumen = { id: string; titulo: string; ruta: string; status: string };
export type Pagina = PaginaResumen & { secciones: Bloque[] };

export type InfoConector = {
  conector: string;
  version: string;
  contrato: number;
  sitio: { nombre: string; url?: string; stack?: string };
  capacidades: string[];
  bloques?: string[];
};

/** Versión del contrato que este worker sabe hablar. */
export const CONTRATO_SOPORTADO = 1;

function señal(timeoutMs: number, externa?: AbortSignal): AbortSignal {
  const propia = AbortSignal.timeout(timeoutMs);
  return externa ? AbortSignal.any([propia, externa]) : propia;
}

async function llamar<T>(
  c: ConectorCreds,
  o: ConectorOptions,
  metodo: string,
  ruta: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const f = o.fetch ?? globalThis.fetch;
  const base = c.baseUrl.replace(/\/+$/, "");
  const res = await f(`${base}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
    signal: señal(timeoutMs, o.abortSignal),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `conector ${metodo} ${ruta}: la base ${base} redirige a ${res.headers.get("location") ?? "otra URL"} — configura la URL exacta del sitio`,
    );
  }
  const texto = await res.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuesta no-JSON: se reporta abajo con el cuerpo crudo */
  }
  if (!res.ok) {
    const d = datos as { error?: string; detalle?: string } | null;
    throw new Error(
      `conector ${metodo} ${ruta} (${res.status}): ${d?.error ?? texto.slice(0, 200)}${
        d?.detalle ? ` — ${d.detalle}` : ""
      }`,
    );
  }
  return datos as T;
}

export async function info(c: ConectorCreds, o: ConectorOptions = {}): Promise<InfoConector> {
  const i = await llamar<InfoConector>(c, o, "GET", "/info", undefined, 15_000);
  if (typeof i?.contrato !== "number" || !Array.isArray(i?.capacidades)) {
    throw new Error("conector: /info no cumple el contrato");
  }
  if (i.contrato > CONTRATO_SOPORTADO) {
    throw new Error(
      `conector: el sitio habla contrato v${i.contrato} y este worker soporta hasta v${CONTRATO_SOPORTADO}`,
    );
  }
  return i;
}

export async function health(
  c: ConectorCreds,
  o: ConectorOptions = {},
): Promise<{
  ok: boolean;
  writable: boolean;
  siteName?: string;
  capacidades?: string[];
  error?: string;
}> {
  try {
    const i = await info(c, o);
    return {
      ok: true,
      writable: i.capacidades.some((cap) => cap.endsWith("_escribir")),
      siteName: i.sitio?.nombre,
      capacidades: i.capacidades,
    };
  } catch (e) {
    return { ok: false, writable: false, error: e instanceof Error ? e.message : "sin conexión" };
  }
}

export const listarPaginas = (c: ConectorCreds, o: ConectorOptions = {}) =>
  llamar<PaginaResumen[]>(c, o, "GET", "/paginas");

export const leerPagina = (c: ConectorCreds, id: string, o: ConectorOptions = {}) =>
  llamar<Pagina>(c, o, "GET", `/paginas/${encodeURIComponent(id)}`);

export const crearPagina = (
  c: ConectorCreds,
  datos: { titulo: string; ruta?: string; status?: string; secciones: Bloque[] },
  o: ConectorOptions = {},
) => llamar<{ id: string; url?: string }>(c, o, "POST", "/paginas", datos);

export const actualizarPagina = (
  c: ConectorCreds,
  id: string,
  datos: Partial<{ titulo: string; ruta: string; status: string; secciones: Bloque[] }>,
  o: ConectorOptions = {},
) => llamar<{ ok: boolean }>(c, o, "PUT", `/paginas/${encodeURIComponent(id)}`, datos);

export const actualizarSeccion = (
  c: ConectorCreds,
  paginaId: string,
  seccionId: string,
  cambios: Partial<{ tipo: string; props: Record<string, unknown> }>,
  o: ConectorOptions = {},
) =>
  llamar<{ ok: boolean }>(
    c,
    o,
    "PATCH",
    `/paginas/${encodeURIComponent(paginaId)}/secciones/${encodeURIComponent(seccionId)}`,
    cambios,
  );

export const borrarPagina = (c: ConectorCreds, id: string, o: ConectorOptions = {}) =>
  llamar<{ ok: boolean }>(c, o, "DELETE", `/paginas/${encodeURIComponent(id)}`);

export const leerAjustes = (c: ConectorCreds, o: ConectorOptions = {}) =>
  llamar<Record<string, unknown>>(c, o, "GET", "/ajustes");

export const actualizarAjustes = (
  c: ConectorCreds,
  cambios: Record<string, unknown>,
  o: ConectorOptions = {},
) => llamar<{ ok: boolean }>(c, o, "PUT", "/ajustes", cambios);

export const publicar = (c: ConectorCreds, o: ConectorOptions = {}) =>
  llamar<{ ok: boolean; detalle?: string }>(c, o, "POST", "/publicar", {});
