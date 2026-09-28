import "server-only";

/**
 * Conectar la cuenta de Alegra ENTERA: contabilidad, nómina, gastos,
 * inventario y reportes, por el servidor MCP oficial de Alegra.
 *
 * El usuario y el token de la API contable no ven la nómina. Esto sí: el
 * cliente pulsa «Conectar con mi cuenta de Alegra», entra en Alegra como
 * siempre y autoriza. Es de solo lectura por diseño de Alegra.
 *
 * Va en la MISMA fila de `public.connections` que el token (`provider =
 * 'alegra'`), dentro del sobre cifrado como `mcp`: así los encargos siguen
 * colgando de una sola conexión y el worker encuentra las dos cosas juntas
 * (`apps/worker/src/adaptadores/libros.ts`).
 *
 * El `state` viaja cifrado con quién lo pidió, a qué espacio va, el cliente
 * OAuth registrado y el verificador de PKCE: nada de eso puede cambiarse por
 * el camino ni reutilizarse pasado un rato.
 */
import {
  canjearCodigo,
  crearAlegraMcp,
  pkce,
  registrarCliente,
  urlDeAutorizacion,
  type CredencialesMcpAlegra,
} from "@strappy/administrativo/alegra-mcp";
import { decryptJson, encryptJson, masterKeyFromEnv } from "@strappy/webmaster/crypto";
import { conEspacio } from "@/lib/db/pool";

export const RUTA_CONTABILIDAD = "/ajustes/contabilidad";
const RUTA_RETORNO = "/api/alegra/retorno";
const VIGENCIA_ESTADO_MS = 15 * 60_000;

export function rutaDeVuelta(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/api/")) return RUTA_CONTABILIDAD;
  return valor;
}

/** A dónde mandar al navegador para autorizar en Alegra. */
export async function urlParaConectarAlegra(input: {
  workspaceId: string;
  userId: string;
  origen: string;
  volver: string;
}): Promise<string> {
  const redirectUri = new URL(RUTA_RETORNO, input.origen).toString();
  // Registro dinámico: Alegra da un cliente público para esta dirección de
  // vuelta. No hay secreto que guardar; PKCE es lo que protege el canje.
  const clientId = await registrarCliente(redirectUri);
  const { verificador, desafio } = pkce();
  const state = Buffer.from(
    encryptJson(
      { w: input.workspaceId, u: input.userId, v: input.volver, c: clientId, p: verificador, exp: Date.now() + VIGENCIA_ESTADO_MS },
      masterKeyFromEnv(),
    ),
  ).toString("base64url");
  return urlDeAutorizacion({ clientId, redirectUri, state, desafio });
}

type Estado = { workspaceId: string; userId: string; volver: string; clientId: string; verificador: string };

export function leerEstadoAlegra(state: string): Estado | null {
  try {
    const d = decryptJson<Record<string, unknown>>(Buffer.from(state, "base64url").toString(), masterKeyFromEnv());
    const { w, u, v, c, p, exp } = d;
    if (typeof w !== "string" || typeof u !== "string" || typeof c !== "string" || typeof p !== "string") return null;
    if (typeof exp !== "number" || exp < Date.now()) return null;
    return { workspaceId: w, userId: u, volver: rutaDeVuelta(typeof v === "string" ? v : null), clientId: c, verificador: p };
  } catch {
    return null;
  }
}

export type ResultadoAlegraCompleto = { ok: true; consultas: number } | { ok: false; mensaje: string };

/** Canjea el código, comprueba que el acceso sirve de verdad y lo guarda. */
export async function completarConexionAlegra(input: {
  estado: Estado;
  code: string;
  origen: string;
  usuarioId: string;
}): Promise<ResultadoAlegraCompleto> {
  const redirectUri = new URL(RUTA_RETORNO, input.origen).toString();
  let mcp: CredencialesMcpAlegra;
  try {
    const tokens = await canjearCodigo({
      clientId: input.estado.clientId,
      code: input.code,
      verificador: input.estado.verificador,
      redirectUri,
    });
    mcp = { clientId: input.estado.clientId, ...tokens };
  } catch (e) {
    return { ok: false, mensaje: `Alegra no completó la autorización (${e instanceof Error ? e.message.slice(0, 140) : "sin respuesta"}).` };
  }

  // Se prueba antes de guardar: una autorización que no deja ver nada no es una conexión.
  let consultas = 0;
  try {
    consultas = (await crearAlegraMcp({ token: mcp.accessToken }).herramientas()).length;
  } catch (e) {
    return { ok: false, mensaje: `Autorizaste, pero Alegra no nos deja consultar tu cuenta (${e instanceof Error ? e.message.slice(0, 140) : "sin respuesta"}).` };
  }
  if (consultas === 0) return { ok: false, mensaje: "Alegra no ofrece ninguna consulta para esta cuenta." };

  await guardarAccesoCompleto({ workspaceId: input.estado.workspaceId, usuarioId: input.usuarioId, mcp, consultas });
  return { ok: true, consultas };
}

/**
 * Lo añade a la conexión de Alegra que ya hubiera (conservando usuario y token)
 * o crea una solo con esto. Nunca pisa el acceso contable que ya estaba.
 */
async function guardarAccesoCompleto(input: {
  workspaceId: string;
  usuarioId: string;
  mcp: CredencialesMcpAlegra;
  consultas: number;
}): Promise<void> {
  const clave = masterKeyFromEnv();
  await conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string; credentials_encrypted: string | null }>(
      `select id, credentials_encrypted from public.connections
        where workspace_id = $1 and provider = 'alegra' and status <> 'revoked'
        order by updated_at desc limit 1`,
      [input.workspaceId],
    );
    const fila = rows[0];
    const metadata = JSON.stringify({ sistema: "Alegra", nombre: "Alegra", mcp: true, mcp_consultas: input.consultas });
    if (fila) {
      let anteriores: Record<string, unknown> = {};
      try {
        anteriores = fila.credentials_encrypted ? decryptJson<Record<string, unknown>>(fila.credentials_encrypted, clave) : {};
      } catch {
        /* indescifrable: se sustituye por lo nuevo */
      }
      await scope.query(
        `update public.connections
            set credentials_encrypted = $2, metadata = metadata || $3::jsonb,
                status = 'active', last_verified_at = now(), updated_at = now()
          where id = $1`,
        [fila.id, encryptJson({ ...anteriores, mcp: input.mcp }, clave), metadata],
      );
      return;
    }
    await scope.query(
      `insert into public.connections
         (workspace_id, provider, name, auth_type, credentials_encrypted, key_version,
          metadata, status, last_verified_at, created_by)
       values ($1, 'alegra', 'Alegra', 'oauth2', $2, 1, $3::jsonb, 'active', now(), $4)
       on conflict (workspace_id, provider, name) do update set
         credentials_encrypted = excluded.credentials_encrypted,
         metadata = public.connections.metadata || excluded.metadata,
         status = 'active', last_verified_at = now(), updated_at = now()`,
      [
        input.workspaceId,
        encryptJson({ mcp: input.mcp }, clave),
        JSON.stringify({ ...JSON.parse(metadata), primer_contacto: false }),
        input.usuarioId,
      ],
    );
  });
}

/** Si el espacio tiene la cuenta entera conectada, y cuántas consultas ofrece. */
export async function alegraCompletoDelEspacio(workspaceId: string): Promise<{ consultas: number } | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ consultas: string | null }>(
      `select metadata->>'mcp_consultas' as consultas from public.connections
        where workspace_id = $1 and provider = 'alegra' and status = 'active'
          and (metadata->>'mcp')::boolean is true
        order by updated_at desc limit 1`,
      [workspaceId],
    );
    const f = rows[0];
    return f ? { consultas: Number(f.consultas ?? 0) } : null;
  });
}

/** Deja de usar la cuenta entera; el usuario y el token, si los hay, siguen. */
export async function desconectarAlegraCompleto(workspaceId: string): Promise<void> {
  const clave = masterKeyFromEnv();
  await conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string; credentials_encrypted: string | null }>(
      `select id, credentials_encrypted from public.connections
        where workspace_id = $1 and provider = 'alegra' and (metadata->>'mcp')::boolean is true`,
      [workspaceId],
    );
    for (const f of rows) {
      let cred: Record<string, unknown> = {};
      try {
        cred = f.credentials_encrypted ? decryptJson<Record<string, unknown>>(f.credentials_encrypted, clave) : {};
      } catch {
        /* nada que conservar */
      }
      delete cred.mcp;
      const quedaAlgo = typeof cred.usuario === "string" && typeof cred.secreto === "string";
      await scope.query(
        `update public.connections
            set credentials_encrypted = $2, metadata = (metadata - 'mcp_consultas') || '{"mcp": false}'::jsonb,
                status = $3, updated_at = now()
          where id = $1`,
        [f.id, encryptJson(cred, clave), quedaAlgo ? "active" : "revoked"],
      );
    }
  });
}
