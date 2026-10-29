/**
 * Salida a internet sin leer la red interna.
 *
 * Varias piezas descargan una URL que eligió alguien de fuera: el cliente al
 * añadir una fuente de conocimiento o la dirección de su sitio, o el modelo al
 * subir una imagen a WordPress. Un `fetch` a pelo convierte cualquiera de esas
 * en un lector de la red interna del servidor: `http://169.254.169.254/` da
 * credenciales de la nube, `http://10.0.0.5:8080/` un panel sin contraseña, y
 * una redirección 302 desde un dominio público llega al mismo sitio.
 *
 * Aquí vive la única regla, para que todos los sumideros la compartan:
 *  - solo http(s), a los puertos normales;
 *  - el nombre se resuelve y TODAS sus direcciones deben ser públicas;
 *  - las redirecciones se siguen a mano, comprobando cada salto igual.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UrlNoPublicaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "UrlNoPublicaError";
  }
}

const RANGOS_PRIVADOS_V4: readonly [number, number][] = [
  [ip4("0.0.0.0"), 8],
  [ip4("10.0.0.0"), 8],
  [ip4("100.64.0.0"), 10],
  [ip4("127.0.0.0"), 8],
  [ip4("169.254.0.0"), 16],
  [ip4("172.16.0.0"), 12],
  [ip4("192.0.0.0"), 24],
  [ip4("192.0.2.0"), 24],
  [ip4("192.168.0.0"), 16],
  [ip4("198.18.0.0"), 15],
  [ip4("198.51.100.0"), 24],
  [ip4("203.0.113.0"), 24],
  [ip4("224.0.0.0"), 4],
  [ip4("240.0.0.0"), 4],
];

function ip4(texto: string): number {
  return texto.split(".").reduce((acc, parte) => ((acc << 8) | Number(parte)) >>> 0, 0);
}

function enRango(ip: number, [base, bits]: readonly [number, number]): boolean {
  const mascara = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mascara) >>> 0) === ((base & mascara) >>> 0);
}

/** Una dirección IP, v4 o v6, que no es de internet: loopback, privada, enlace local, metadatos. */
export function esDireccionPrivada(ip: string): boolean {
  const limpia = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(limpia);
  if (version === 4) {
    const n = ip4(limpia);
    return RANGOS_PRIVADOS_V4.some((r) => enRango(n, r));
  }
  if (version === 6) {
    if (limpia === "::" || limpia === "::1") return true;
    // IPv4 embebida: ::ffff:10.0.0.1
    const embebida = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia);
    if (embebida) return esDireccionPrivada(embebida[1]!);
    if (/^f[cd]/.test(limpia)) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(limpia)) return true; // enlace local fe80::/10
    if (/^ff/.test(limpia)) return true; // multicast
    if (/^64:ff9b:/.test(limpia)) return true; // NAT64
    if (/^2001:db8:/.test(limpia)) return true; // documentación
    return false;
  }
  // No es una IP: que el que resuelve decida.
  return false;
}

const PUERTOS_PERMITIDOS = new Set(["", "80", "443", "8080", "8443"]);

export type UrlPublica = {
  readonly url: URL;
  /** Direcciones a las que resuelve el nombre; todas públicas. */
  readonly direcciones: readonly string[];
};

/**
 * Comprueba que una URL apunta a internet y no a la red del servidor.
 * Lanza `UrlNoPublicaError` con un motivo entendible si no.
 */
export async function comprobarUrlPublica(
  entrada: string | URL,
  opciones: { readonly resolver?: (host: string) => Promise<readonly string[]> } = {},
): Promise<UrlPublica> {
  let url: URL;
  try {
    url = typeof entrada === "string" ? new URL(entrada) : entrada;
  } catch {
    throw new UrlNoPublicaError("Esa dirección no es una URL válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlNoPublicaError("Solo se admiten direcciones http o https.");
  }
  if (!PUERTOS_PERMITIDOS.has(url.port)) {
    throw new UrlNoPublicaError(`El puerto ${url.port} no está permitido.`);
  }
  if (url.username || url.password) {
    throw new UrlNoPublicaError("La dirección no puede llevar usuario ni contraseña.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UrlNoPublicaError(`«${host}» es un nombre de la red interna.`);
  }
  if (isIP(host)) {
    if (esDireccionPrivada(host)) throw new UrlNoPublicaError(`La dirección ${host} no es pública.`);
    return { url, direcciones: [host] };
  }
  if (!host.includes(".")) {
    throw new UrlNoPublicaError(`«${host}» no parece un dominio de internet.`);
  }

  const resolver = opciones.resolver ?? resolverTodas;
  let direcciones: readonly string[];
  try {
    direcciones = await resolver(host);
  } catch {
    throw new UrlNoPublicaError(`No pude resolver el dominio «${host}».`);
  }
  if (direcciones.length === 0) throw new UrlNoPublicaError(`El dominio «${host}» no resuelve.`);
  const privada = direcciones.find(esDireccionPrivada);
  if (privada) {
    throw new UrlNoPublicaError(`«${host}» resuelve a una dirección privada (${privada}).`);
  }
  return { url, direcciones };
}

async function resolverTodas(host: string): Promise<readonly string[]> {
  const todas = await lookup(host, { all: true });
  return todas.map((d) => d.address);
}

export type OpcionesFetchPublico = RequestInit & {
  /** Cuántas redirecciones se siguen, comprobando cada destino. */
  readonly maximoRedirecciones?: number;
  readonly resolver?: (host: string) => Promise<readonly string[]>;
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * `fetch` que solo sale a internet. Sigue redirecciones a mano y comprueba
 * cada salto, para que un dominio público no pueda rebotar hacia dentro.
 */
export async function fetchPublico(entrada: string | URL, opciones: OpcionesFetchPublico = {}): Promise<Response> {
  const { maximoRedirecciones = 5, resolver, fetch: f = globalThis.fetch, ...init } = opciones;
  let actual = (await comprobarUrlPublica(entrada, resolver ? { resolver } : {})).url;
  let metodo = init.method ?? "GET";
  let cuerpo = init.body;

  for (let salto = 0; ; salto++) {
    const respuesta = await f(actual, { ...init, method: metodo, body: cuerpo, redirect: "manual" });
    const destino = respuesta.headers.get("location");
    if (!destino || respuesta.status < 300 || respuesta.status > 399) return respuesta;
    if (salto >= maximoRedirecciones) {
      throw new UrlNoPublicaError("Demasiadas redirecciones.");
    }
    let siguiente: URL;
    try {
      siguiente = new URL(destino, actual);
    } catch {
      throw new UrlNoPublicaError("La redirección apunta a una dirección inválida.");
    }
    actual = (await comprobarUrlPublica(siguiente, resolver ? { resolver } : {})).url;
    if (respuesta.status === 303 || ((respuesta.status === 301 || respuesta.status === 302) && metodo === "POST")) {
      metodo = "GET";
      cuerpo = undefined;
    }
  }
}
