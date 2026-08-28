/**
 * Salida HTTP por defecto para el rastreo web.
 *
 * Se mantiene aparte del resto del paquete para que los tests puedan inyectar
 * un `FetchPort` de mentira y no toque la red nadie sin querer.
 */
import type { FetchPort, RespuestaHttp } from "../ports.js";

export type OpcionesFetch = {
  readonly agente?: string;
  readonly timeoutMs?: number;
  /** Tope de descarga. Una página de 40 MB no es contenido, es un accidente. */
  readonly maximoBytes?: number;
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
        const respuesta = await fetch(input.url, {
          headers: { "user-agent": agente, accept: "text/html,application/xhtml+xml,text/plain,*/*" },
          redirect: "follow",
          signal: control.signal,
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
