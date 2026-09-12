/**
 * Las comprobaciones de una ronda de vigilancia.
 *
 * Aquí sí hay red, pero NO hay modelo: son peticiones HTTP y una conexión TLS.
 * Vigilar un sitio no gasta ni un crédito del cliente; solo se cobra si a
 * partir de un aviso pide un encargo, que es una tarea normal.
 *
 * El reparto entre barato y caro es la decisión que sostiene todo esto:
 *
 *  · En CADA ronda (dos peticiones): la portada tal como la ve un visitante,
 *    saltándose la caché, y la REST API con las credenciales guardadas. Son las
 *    dos cosas que cambian de un minuto a otro.
 *  · Una vez al DÍA: el certificado, los complementos y los errores de la
 *    página. Un certificado no vence entre las 10:00 y las 10:15, y abrir el
 *    navegador cuesta memoria y segundos.
 *
 * Nada de lo que hay aquí escribe en el sitio del cliente.
 */
import { connect as conectarTls } from "node:tls";
import type { BrowserPort, WpCreds } from "../ports.js";
import { baseUrl, health, listarPlugins, verificar } from "../wordpress/client.js";
import {
  tocaComprobacionDiaria,
  type Chequeo,
  type EstadoVigilancia,
  type MedidaCertificado,
  type MedidaPlugins,
  type MedidaPortada,
} from "./decidir.js";

export type OpcionesChequeo = {
  readonly creds: WpCreds;
  /** Lo que se recuerda de la ronda anterior: decide qué comprobaciones caras tocan. */
  readonly estado: EstadoVigilancia;
  /** ISO 8601. Se inyecta para que los tests no dependan del reloj. */
  readonly ahora: string;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Navegador para leer los errores de la portada. Opcional a propósito: sin
   * él la vigilancia sigue funcionando, solo que sin esa medida.
   */
  readonly navegador?: BrowserPort;
  /** Forzar las comprobaciones caras (para una revisión a petición). */
  readonly forzarDiarias?: boolean;
};

/** Cuántos complementos se consultan contra wordpress.org como mucho. */
const MAX_PLUGINS_CONSULTADOS = 20;

export async function comprobarSitio(o: OpcionesChequeo): Promise<Chequeo> {
  const { creds, estado, ahora } = o;
  const opcionesWp = o.fetch ? { fetch: o.fetch } : {};

  const portada = await medirPortada(creds, opcionesWp);

  // Con la portada caída, lo demás sobra: fallaría todo por la misma razón y
  // solo serviría para castigar a un servidor que ya está sufriendo.
  if (!portada.ok) return { en: ahora, portada };

  const salud = await health(creds, opcionesWp);
  const chequeo: Chequeo = {
    en: ahora,
    portada,
    rest: {
      ok: salud.ok,
      credenciales: salud.writable,
      ...(salud.error ? { error: salud.error } : {}),
    },
  };

  const toca = (ultima: string | undefined): boolean =>
    o.forzarDiarias === true || tocaComprobacionDiaria(ultima, ahora);

  const [certificado, plugins, consola] = await Promise.all([
    toca(estado.certMedidoEn) ? medirCertificado(baseUrl(creds)) : Promise.resolve(undefined),
    toca(estado.pluginsMedidosEn) && salud.writable
      ? medirPlugins(creds, opcionesWp, o.fetch)
      : Promise.resolve(undefined),
    toca(estado.consolaMedidaEn) && o.navegador
      ? medirConsola(o.navegador)
      : Promise.resolve(undefined),
  ]);

  return {
    ...chequeo,
    ...(certificado ? { certificado } : {}),
    ...(plugins ? { plugins } : {}),
    ...(consola ? { consola } : {}),
  };
}

// ---------------------------------------------------------------------------
// Barato: en cada ronda
// ---------------------------------------------------------------------------

async function medirPortada(
  creds: WpCreds,
  opciones: { fetch?: typeof globalThis.fetch },
): Promise<MedidaPortada> {
  try {
    const r = await verificar(creds, "/", undefined, opciones);
    return { ok: r.ok, status: r.status, ms: r.ms };
  } catch (e) {
    // Ni siquiera hubo respuesta: DNS, certificado inválido, servidor caído o
    // tiempo agotado. Todos son «no abre» para quien visita la web.
    return { ok: false, status: null, ms: null, error: e instanceof Error ? e.message : "sin conexión" };
  }
}

// ---------------------------------------------------------------------------
// Caro: una vez al día
// ---------------------------------------------------------------------------

/**
 * Días que le quedan al certificado. Se lee del propio apretón de manos TLS:
 * `fetch` no expone el certificado, así que hace falta la conexión a pelo.
 */
export function medirCertificado(url: string, timeoutMs = 10_000): Promise<MedidaCertificado | undefined> {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return Promise.resolve(undefined);
  }
  if (destino.protocol !== "https:") return Promise.resolve(undefined);

  const host = destino.hostname;
  const puerto = destino.port ? Number(destino.port) : 443;

  return new Promise<MedidaCertificado | undefined>((resolver) => {
    let resuelto = false;
    const terminar = (valor: MedidaCertificado | undefined) => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      resolver(valor);
    };

    const socket = conectarTls(
      {
        host,
        port: puerto,
        servername: host,
        // Un certificado vencido o mal emitido es justo lo que hay que medir:
        // rechazarlo aquí devolvería un error en vez del dato.
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) {
          terminar({ diasRestantes: 0, caducaEn: "", error: "sin certificado" });
          return;
        }
        const caduca = new Date(cert.valid_to);
        if (Number.isNaN(caduca.getTime())) {
          terminar({ diasRestantes: 0, caducaEn: "", error: "fecha ilegible" });
          return;
        }
        const dias = Math.floor((caduca.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        terminar({
          diasRestantes: dias,
          caducaEn: caduca.toISOString(),
          ...(cert.issuer?.O ? { emisor: String(cert.issuer.O) } : {}),
        });
      },
    );

    socket.setTimeout(timeoutMs, () => terminar({ diasRestantes: 0, caducaEn: "", error: "sin respuesta" }));
    socket.on("error", (e: Error) => terminar({ diasRestantes: 0, caducaEn: "", error: e.message }));
  });
}

/**
 * Complementos con actualización pendiente.
 *
 * La REST API de WordPress da la versión instalada pero NO dice si hay una más
 * nueva, así que la versión de referencia se pregunta al directorio público de
 * wordpress.org, que no necesita credenciales. Los de pago no están allí: se
 * omiten en silencio en vez de inventarse un aviso.
 */
async function medirPlugins(
  creds: WpCreds,
  opciones: { fetch?: typeof globalThis.fetch },
  fetchExterno: typeof globalThis.fetch | undefined,
): Promise<MedidaPlugins | undefined> {
  let instalados;
  try {
    instalados = await listarPlugins(creds, opciones);
  } catch {
    return undefined;
  }
  if (instalados.length === 0) return { pendientes: 0, nombres: [] };

  const f = fetchExterno ?? globalThis.fetch;
  const activos = instalados.filter((p) => p.status === "active").slice(0, MAX_PLUGINS_CONSULTADOS);

  const nombres: string[] = [];
  await Promise.all(
    activos.map(async (p) => {
      const slug = p.plugin.split("/")[0];
      if (!slug || !p.version) return;
      try {
        const r = await f(
          `https://api.wordpress.org/plugins/info/1.0/${encodeURIComponent(slug)}.json`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!r.ok) return;
        const datos = (await r.json()) as { version?: string };
        if (datos.version && esMasNueva(datos.version, p.version)) nombres.push(p.name);
      } catch {
        // El directorio no responde o el complemento es de pago: no es un
        // problema del cliente y no debe ensuciar la ronda.
      }
    }),
  );

  return { pendientes: nombres.length, nombres };
}

/** Compara dos versiones tipo `3.21.4`. Trata lo no numérico como cero. */
export function esMasNueva(candidata: string, instalada: string): boolean {
  const partes = (v: string) => v.split(/[.\-+]/).map((n) => (Number.isNaN(Number(n)) ? 0 : Number(n)));
  const a = partes(candidata);
  const b = partes(instalada);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function medirConsola(navegador: BrowserPort): Promise<Chequeo["consola"]> {
  try {
    await navegador.ir("/", false);
    const { consola } = await navegador.consola();
    // Solo lo que el navegador marcó como error. Filtrar por la palabra
    // «error» colaba advertencias que la mencionan («deprecated: … error
    // handling»), y una advertencia nunca es un fallo del sitio.
    const errores = consola.filter((l) => l.startsWith("[error]"));
    return { errores };
  } catch {
    return undefined;
  }
}
