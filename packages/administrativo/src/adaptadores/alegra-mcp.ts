/**
 * Alegra entero, por su servidor MCP oficial.
 *
 * La API contable de Alegra (usuario y token) no ve la nómina: Alegra Nómina es
 * otro servicio y solo entrega sus datos a un token emitido por Alegra. Su
 * servidor MCP (`mcp.alegra.com`) sí lo ve todo —contabilidad, nómina,
 * reportes, inventario, gastos— y se entra con OAuth, como el cliente entra a
 * su propia cuenta. Es de solo lectura por diseño de Alegra.
 *
 * Aquí viven las dos mitades:
 *  - OAuth 2.1 con registro dinámico y PKCE: Strappy se registra sola como
 *    cliente público (sin secreto que guardar), el cliente autoriza en Alegra y
 *    nos quedamos con un token de acceso y otro de renovación.
 *  - Un cliente MCP mínimo sobre HTTP: `initialize`, `tools/list` y
 *    `tools/call`. Sin dependencias: el protocolo es JSON-RPC por POST, con la
 *    respuesta en JSON o en un evento SSE.
 */
import { createHash, randomBytes } from "node:crypto";

type Fetch = typeof globalThis.fetch;

export const AUTH_ALEGRA = "https://auth-api.alegra.com";
/** El recurso que se pide en OAuth y la dirección del servidor MCP. */
export const MCP_ALEGRA = "https://mcp.alegra.com/mcp";
const VERSION_PROTOCOLO = "2025-06-18";

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export type TokensAlegra = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch en milisegundos. */
  readonly expiraEn: number;
};

/** Lo que se guarda cifrado en la conexión: el cliente registrado y sus tokens. */
export type CredencialesMcpAlegra = TokensAlegra & { readonly clientId: string };

async function json<T>(res: Response, que: string): Promise<T> {
  const texto = await res.text();
  if (!res.ok) throw new Error(`Alegra ${que} respondió ${res.status}: ${texto.slice(0, 240)}`);
  return JSON.parse(texto) as T;
}

/** Registra Strappy como cliente público para esta dirección de vuelta. */
export async function registrarCliente(redirectUri: string, f: Fetch = globalThis.fetch): Promise<string> {
  const r = await json<{ client_id: string }>(
    await f(`${AUTH_ALEGRA}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Strappy",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "owner",
      }),
      signal: AbortSignal.timeout(15_000),
    }),
    "al registrar la aplicación",
  );
  return r.client_id;
}

/** El par de PKCE: el verificador se guarda, el desafío viaja a Alegra. */
export function pkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(48).toString("base64url");
  const desafio = createHash("sha256").update(verificador).digest("base64url");
  return { verificador, desafio };
}

export function urlDeAutorizacion(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  desafio: string;
}): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "owner",
    state: input.state,
    code_challenge: input.desafio,
    code_challenge_method: "S256",
    resource: MCP_ALEGRA,
  });
  return `${AUTH_ALEGRA}/oauth/authorize?${q}`;
}

type RespuestaToken = { access_token: string; refresh_token?: string; expires_in?: number };

function aTokens(r: RespuestaToken, anterior?: string | null): TokensAlegra {
  return {
    accessToken: r.access_token,
    // Si Alegra no rota el de renovación, se conserva el que había.
    refreshToken: r.refresh_token ?? anterior ?? null,
    expiraEn: Date.now() + (r.expires_in ?? 3600) * 1000,
  };
}

export async function canjearCodigo(
  input: { clientId: string; code: string; verificador: string; redirectUri: string },
  f: Fetch = globalThis.fetch,
): Promise<TokensAlegra> {
  const r = await json<RespuestaToken>(
    await f(`${AUTH_ALEGRA}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.clientId,
        code_verifier: input.verificador,
        resource: MCP_ALEGRA,
      }),
      signal: AbortSignal.timeout(15_000),
    }),
    "al canjear la autorización",
  );
  return aTokens(r);
}

export async function renovarTokens(
  input: { clientId: string; refreshToken: string },
  f: Fetch = globalThis.fetch,
): Promise<TokensAlegra> {
  const r = await json<RespuestaToken>(
    await f(`${AUTH_ALEGRA}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        resource: MCP_ALEGRA,
      }),
      signal: AbortSignal.timeout(15_000),
    }),
    "al renovar el acceso",
  );
  return aTokens(r, input.refreshToken);
}

/** Si el token caduca en menos de dos minutos, se renueva antes de usarlo. */
export function necesitaRenovar(t: TokensAlegra, ahora = Date.now()): boolean {
  return t.expiraEn - ahora < 2 * 60_000;
}

// ---------------------------------------------------------------------------
// Cliente MCP
// ---------------------------------------------------------------------------

export type HerramientaMcp = {
  readonly nombre: string;
  readonly descripcion: string;
  readonly esquema: Readonly<Record<string, unknown>>;
  /** Lo que el servidor declara; `null` si no lo dice. */
  readonly soloLectura: boolean | null;
};

export type ResultadoMcp = {
  readonly texto: string;
  /** El contenido estructurado, si el servidor lo da o si el texto era JSON. */
  readonly datos: unknown;
  readonly esError: boolean;
};

export interface AlegraMcpPort {
  herramientas(): Promise<readonly HerramientaMcp[]>;
  llamar(nombre: string, argumentos: Record<string, unknown>): Promise<ResultadoMcp>;
}

export type OpcionesMcp = {
  readonly url?: string;
  readonly token: string;
  readonly fetch?: Fetch;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
};

type Mensaje = { id?: number; result?: unknown; error?: { code: number; message: string } };

/** El mensaje JSON-RPC de una respuesta, venga como JSON o como flujo SSE. */
async function leerRespuesta(res: Response, id: number): Promise<Mensaje | null> {
  const tipo = res.headers.get("content-type") ?? "";
  const cuerpo = await res.text();
  if (!cuerpo.trim()) return null;
  if (tipo.includes("text/event-stream")) {
    const mensajes = cuerpo
      .split(/\r?\n\r?\n/)
      .map((evento) =>
        evento
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n"),
      )
      .filter(Boolean)
      .map((d) => {
        try {
          return JSON.parse(d) as Mensaje;
        } catch {
          return null;
        }
      })
      .filter((m): m is Mensaje => m !== null);
    return mensajes.find((m) => m.id === id) ?? mensajes[mensajes.length - 1] ?? null;
  }
  return JSON.parse(cuerpo) as Mensaje;
}

export function crearAlegraMcp(o: OpcionesMcp): AlegraMcpPort {
  const f = o.fetch ?? globalThis.fetch;
  const url = o.url ?? MCP_ALEGRA;
  let sesion: string | null = null;
  let iniciado: Promise<void> | null = null;
  let lista: Promise<readonly HerramientaMcp[]> | null = null;
  let n = 0;

  const señal = () => {
    const propia = AbortSignal.timeout(o.timeoutMs ?? 45_000);
    return o.abortSignal ? AbortSignal.any([propia, o.abortSignal]) : propia;
  };

  async function enviar(metodo: string, params: unknown, notificacion = false): Promise<unknown> {
    const id = ++n;
    const res = await f(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${o.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sesion ? { "mcp-session-id": sesion } : {}),
        ...(metodo !== "initialize" ? { "mcp-protocol-version": VERSION_PROTOCOLO } : {}),
      },
      body: JSON.stringify(notificacion ? { jsonrpc: "2.0", method: metodo, params } : { jsonrpc: "2.0", id, method: metodo, params }),
      signal: señal(),
    });
    sesion = res.headers.get("mcp-session-id") ?? sesion;
    if (res.status === 401) {
      throw new Error("Alegra rechazó el acceso: la autorización caducó o se revocó. Hay que reconectar Alegra en Ajustes → Contabilidad.");
    }
    if (!res.ok && !(notificacion && res.status === 202)) {
      throw new Error(`Alegra MCP respondió ${res.status} a ${metodo}: ${(await res.text()).slice(0, 240)}`);
    }
    if (notificacion) return null;
    const m = await leerRespuesta(res, id);
    if (!m) throw new Error(`Alegra MCP no contestó a ${metodo}.`);
    if (m.error) throw new Error(`Alegra MCP (${metodo}): ${m.error.message}`);
    return m.result;
  }

  function iniciar(): Promise<void> {
    iniciado ??= (async () => {
      await enviar("initialize", {
        protocolVersion: VERSION_PROTOCOLO,
        capabilities: {},
        clientInfo: { name: "strappy-administrativo", version: "1.0.0" },
      });
      await enviar("notifications/initialized", {}, true);
    })();
    iniciado.catch(() => {
      iniciado = null;
    });
    return iniciado;
  }

  return {
    herramientas() {
      lista ??= (async () => {
        await iniciar();
        const todas: HerramientaMcp[] = [];
        let cursor: string | undefined;
        for (let pagina = 0; pagina < 20; pagina++) {
          const r = (await enviar("tools/list", cursor ? { cursor } : {})) as {
            tools?: {
              name: string;
              description?: string;
              inputSchema?: Record<string, unknown>;
              annotations?: { readOnlyHint?: boolean };
            }[];
            nextCursor?: string;
          };
          for (const t of r.tools ?? []) {
            todas.push({
              nombre: t.name,
              descripcion: t.description ?? "",
              esquema: t.inputSchema ?? { type: "object" },
              soloLectura: typeof t.annotations?.readOnlyHint === "boolean" ? t.annotations.readOnlyHint : null,
            });
          }
          if (!r.nextCursor) break;
          cursor = r.nextCursor;
        }
        return todas;
      })();
      lista.catch(() => {
        lista = null;
      });
      return lista;
    },

    async llamar(nombre, argumentos) {
      await iniciar();
      const r = (await enviar("tools/call", { name: nombre, arguments: argumentos })) as {
        content?: { type: string; text?: string }[];
        structuredContent?: unknown;
        isError?: boolean;
      };
      const texto = (r.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text!)
        .join("\n");
      let datos: unknown = r.structuredContent ?? null;
      if (datos === null) {
        try {
          datos = JSON.parse(texto);
        } catch {
          /* texto libre: se queda como texto */
        }
      }
      return { texto, datos, esError: Boolean(r.isError) };
    },
  };
}
