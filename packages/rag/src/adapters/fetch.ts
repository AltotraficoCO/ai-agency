/**
 * Salida HTTP por defecto para el rastreo web.
 *
 * Se mantiene aparte del resto del paquete para que los tests puedan inyectar
 * un `FetchPort` de mentira y no toque la red nadie sin querer.
 */
import { fetchPublico } from "@strappy/core";
import type { FetchPort, RespuestaHttp } from "../ports.js";

export type OpcionesFetch = {
  readonly agente?: string;
  readonly timeoutMs?: number;
  /** Tope de descarga. Una página de 40 MB no es contenido, es un accidente. */
  readonly maximoBytes?: number;
  /**
   * Resolución DNS inyectable para las pruebas. En producción se resuelve de
   * verdad: la URL (y cada redirección) tiene que apuntar a internet, nunca a
   * la red del servidor. Ver `fetchPublico` en @strappy/core.
   */
  readonly resolver?: (host: string) => Promise<readonly string[]>;
};

export function crearFetch(opciones: OpcionesFetch = {}): FetchPort {
  const agente = opciones.agente ?? "StrappyBot/1.0 (+https://strappy.co/bot)";
  const maximoBytes = opciones.maximoBytes ?? 4_000_000;

  return {
    async obtener(input): Promise<RespuestaHttp> {
      const control = new AbortController();
      const ms = input.timeoutMs ?? opciones.timeoutMs ?? 15_000;
      const temporizador = setTimeout(() => {
        control.abort();
      }, ms);
      const alAbortar = (): void => {
        control.abort();
      };
      input.signal?.addEventListener("abort", alAbortar);
      try {
        const respuesta = await fetchPublico(input.url, {
          headers: { "user-agent": agente, accept: "text/html,application/xhtml+xml,text/plain,*/*" },
          signal: control.signal,
          ...(opciones.resolver ? { resolver: opciones.resolver } : {}),
        });
        const contentType = respuesta.headers.get("content-type") ?? "";
        const largo = Number.parseInt(respuesta.headers.get("content-length") ?? "", 10);
        if (Number.isFinite(largo) && largo > maximoBytes) {
          return { status: respuesta.status, finalUrl: respuesta.url, contentType, body: "" };
        }
        const body = (await respuesta.text()).slice(0, maximoBytes);
        return { status: respuesta.status, finalUrl: respuesta.url || input.url, contentType, body };
      } finally {
        clearTimeout(temporizador);
        input.signal?.removeEventListener("abort", alAbortar);
      }
    },
  };
}
