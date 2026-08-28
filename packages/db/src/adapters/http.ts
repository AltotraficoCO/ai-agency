/**
 * `HttpPort` con lista blanca.
 *
 * Deny by default de verdad: si el host no está declarado en la conexión del
 * workspace, la llamada no sale. Se comprueba el host TRAS resolver la URL, se
 * prohíbe el redirigido automático y se bloquean las direcciones privadas —una
 * herramienta que puede pedir `http://169.254.169.254/` es una fuga de
 * credenciales del servidor, no una integración.
 */
import { lookup } from 'node:dns/promises';
import type { HttpPort } from '@strappy/tools';
import type { TenantScope } from '../client.js';

export class HostNoPermitidoError extends Error {
  constructor(host: string) {
    super(`El host "${host}" no está en la lista de hosts permitidos de este espacio.`);
    this.name = 'HostNoPermitidoError';
  }
}

const RANGOS_PRIVADOS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^::1$/,
  /^f[cd]/i,
];

export function esDireccionPrivada(ip: string): boolean {
  return RANGOS_PRIVADOS.some((r) => r.test(ip));
}

export function crearHttpPort(allowedHosts: readonly string[]): HttpPort {
  const permitidos = new Set(allowedHosts.map((h) => h.toLowerCase()));

  return {
    allowedHosts,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new Error('Solo se permiten llamadas por HTTPS.');
      }
      const host = url.hostname.toLowerCase();
      if (!permitidos.has(host)) throw new HostNoPermitidoError(host);

      if (host !== 'localhost') {
        const { address } = await lookup(host);
        if (esDireccionPrivada(address)) {
          throw new Error(`El host "${host}" resuelve a una dirección privada.`);
        }
      }

      const controlador = new AbortController();
      const temporizador = setTimeout(() => controlador.abort(), request.timeoutMs);
      request.abortSignal?.addEventListener('abort', () => controlador.abort());

      try {
        const respuesta = await globalThis.fetch(url, {
          method: request.method,
          headers: request.headers,
          ...(request.body !== undefined ? { body: request.body } : {}),
          redirect: 'error',
          signal: controlador.signal,
        });
        const cabeceras: Record<string, string> = {};
        respuesta.headers.forEach((v, k) => {
          cabeceras[k] = v;
        });
        return { status: respuesta.status, headers: cabeceras, body: await respuesta.text() };
      } finally {
        clearTimeout(temporizador);
      }
    },
  };
}

/** Hosts que este espacio tiene declarados en sus conexiones. */
export async function hostsPermitidos(scope: TenantScope): Promise<string[]> {
  const { rows } = await scope.query<{ host: string }>(
    `select distinct jsonb_array_elements_text(
              coalesce(metadata->'allowed_hosts', '[]'::jsonb)) as host
       from public.connections
      where workspace_id = $1 and status = 'active'`,
    [scope.workspaceId],
  );
  return rows.map((r) => r.host);
}
