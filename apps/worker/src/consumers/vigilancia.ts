/**
 * Consumidor de vigilancia: el Webmaster mira el sitio sin que nadie se lo pida.
 *
 * Antes de esto, si la web de un cliente se caía un domingo se enteraba el
 * lunes, y por un cliente suyo. Ahora cada sitio conectado se comprueba cada
 * pocos minutos y, cuando algo CAMBIA, queda un aviso escrito en su idioma con
 * una propuesta de qué hacer.
 *
 * Tres cosas que no son de estilo:
 *
 *  - **No gasta créditos.** Aquí no hay modelo: son peticiones HTTP y una
 *    conexión TLS. Por eso este consumidor no recibe `motorPara` ni `rates`.
 *    Si el cliente pide el arreglo, eso ya es un encargo normal y se cobra como
 *    tal.
 *  - **No escribe en el sitio.** Solo lee. Detectar algo arreglable termina en
 *    una propuesta, nunca en un cambio que nadie pidió.
 *  - **Un fallo de un sitio no para la vigilancia de los demás.** Cada ronda se
 *    cierra pase lo que pase, y el sitio se reprograma.
 */
import {
  comprobarSitio,
  decidirAvisos,
  tocaComprobacionDiaria,
  type Aviso,
  type BrowserPort,
  type Chequeo,
  type WpCreds,
} from "@strappy/webmaster";
import type { PuertosWorker, SitioConectado, SitioVigilado, VigilanciaPort } from "../ports.js";
import type { Consumidor } from "./tipos.js";

export type OpcionesConsumidorVigilancia = {
  readonly vigilancia: VigilanciaPort;
  readonly sitios: PuertosWorker["sitios"];
  readonly workerId: string;
  /** Cuánto se reserva un sitio mientras se comprueba. */
  readonly arrendamientoMs?: number;
  /** Cada cuánto se dan de alta los sitios recién conectados. */
  readonly sincronizarCadaMs?: number;
  /**
   * Navegador para leer los errores de la portada, una vez al día. Opcional:
   * sin él la vigilancia sigue, solo que sin esa medida.
   */
  readonly navegadorPara?: (sitio: SitioConectado) => Promise<BrowserPort>;
  /**
   * Dónde se entrega un aviso además de guardarlo. Es la frontera por la que
   * entrará el envío por WhatsApp: el consumidor no sabe de canales.
   */
  readonly alAvisar?: (entrada: {
    workspaceId: string;
    siteId: string;
    sitioUrl: string;
    aviso: Aviso;
  }) => Promise<void>;
  readonly fetchSitio?: typeof globalThis.fetch;
  /** Inyectable para los tests; en producción es el reloj. */
  readonly ahora?: () => Date;
  readonly log?: (mensaje: string) => void;
};

/** Si el sitio no se puede ni cargar, se reintenta dentro de una hora. */
const ESPERA_SITIO_ILEGIBLE_MS = 60 * 60 * 1000;

export class ConsumidorDeVigilancia implements Consumidor {
  readonly nombre = "vigilancia";
  readonly #o: OpcionesConsumidorVigilancia;
  #ultimaSincronizacion = 0;
  #navegadorAbierto: BrowserPort | null = null;

  constructor(o: OpcionesConsumidorVigilancia) {
    this.#o = o;
  }

  async tick(): Promise<boolean> {
    const ahora = (this.#o.ahora ?? (() => new Date()))();
    await this.#sincronizarSiToca(ahora.getTime());

    const sitio = await this.#o.vigilancia.reclamar({
      workerId: this.#o.workerId,
      arrendamientoMs: this.#o.arrendamientoMs ?? 3 * 60 * 1000,
    });
    if (!sitio) return false;

    await this.#comprobar(sitio, ahora);
    return true;
  }

  async cerrar(): Promise<void> {
    await this.#navegadorAbierto?.cerrar().catch(() => {});
    this.#navegadorAbierto = null;
  }

  async #sincronizarSiToca(ahoraMs: number): Promise<void> {
    const cada = this.#o.sincronizarCadaMs ?? 10 * 60 * 1000;
    if (ahoraMs - this.#ultimaSincronizacion < cada) return;
    this.#ultimaSincronizacion = ahoraMs;
    try {
      const altas = await this.#o.vigilancia.sincronizar();
      if (altas > 0) this.#o.log?.(`[vigilancia] ${altas} sitio(s) nuevo(s) bajo vigilancia`);
    } catch (e) {
      this.#o.log?.(`[vigilancia] no pude dar de alta sitios: ${mensajeDe(e)}`);
    }
  }

  async #comprobar(sitio: SitioVigilado, ahora: Date): Promise<void> {
    const { vigilancia, workerId } = this.#o;
    const log = this.#o.log ?? (() => {});
    const enIso = ahora.toISOString();

    let conectado: SitioConectado | null = null;
    try {
      conectado = await this.#o.sitios.cargar({
        workspaceId: sitio.workspaceId,
        siteId: sitio.siteId,
      });
    } catch (e) {
      // Credenciales indescifrables o conexión desactivada: no es algo que se
      // arregle reintentando en quince minutos, y tampoco es un aviso para el
      // cliente desde aquí (lo verá al abrir su sitio en Strappy).
      log(`[vigilancia] ${sitio.siteId}: ${mensajeDe(e)}`);
      await this.#reprogramar(sitio, ESPERA_SITIO_ILEGIBLE_MS, null);
      return;
    }

    // El conector estándar todavía no se vigila: sus comprobaciones son otras.
    if (!conectado || conectado.tipo !== "wp") {
      await this.#reprogramar(sitio, ESPERA_SITIO_ILEGIBLE_MS, null);
      return;
    }

    let chequeo: Chequeo;
    try {
      chequeo = await comprobarSitio({
        creds: conectado.credenciales as WpCreds,
        estado: sitio.estado,
        ahora: enIso,
        ...(this.#o.fetchSitio ? { fetch: this.#o.fetchSitio } : {}),
        ...(await this.#navegador(conectado, sitio.estado, enIso)),
      });
    } catch (e) {
      // Que falle la propia comprobación no puede dejar el sitio sin vigilar.
      log(`[vigilancia] ${conectado.url}: no pude comprobar (${mensajeDe(e)})`);
      await this.#reprogramar(sitio, sitio.cadaMinutos * 60 * 1000, null);
      return;
    }

    const { estado, avisos } = decidirAvisos(sitio.estado, chequeo, {
      nombreSitio: nombreLegible(conectado.url),
    });

    await vigilancia.guardar({
      siteId: sitio.siteId,
      workerId,
      estado,
      chequeo,
      proximaEnMs: sitio.cadaMinutos * 60 * 1000,
    });

    if (avisos.length === 0) return;

    const nuevos = await vigilancia.registrarAvisos({
      workspaceId: sitio.workspaceId,
      siteId: sitio.siteId,
      avisos,
    });
    log(
      `[vigilancia] ${conectado.url} · ${avisos.map((a) => a.titulo).join(" · ")}` +
        (nuevos === avisos.length ? "" : ` (${nuevos} nuevo(s))`),
    );

    if (!this.#o.alAvisar) return;
    for (const aviso of avisos) {
      await this.#o
        .alAvisar({
          workspaceId: sitio.workspaceId,
          siteId: sitio.siteId,
          sitioUrl: conectado.url,
          aviso,
        })
        // Un canal caído no puede tumbar la vigilancia: el aviso ya está escrito.
        .catch((e) => log(`[vigilancia] no pude entregar el aviso: ${mensajeDe(e)}`));
    }
  }

  /**
   * El navegador solo se abre el día que toca mirar los errores de la página, y
   * SIEMPRE uno por sitio: la sesión se abre apuntando a una dirección concreta,
   * así que reutilizar la del sitio anterior mediría la web de otro cliente.
   */
  async #navegador(
    conectado: SitioConectado,
    estado: SitioVigilado["estado"],
    ahora: string,
  ): Promise<{ navegador?: BrowserPort }> {
    if (!this.#o.navegadorPara) return {};
    if (!tocaComprobacionDiaria(estado.consolaMedidaEn, ahora)) return {};
    try {
      await this.cerrar();
      this.#navegadorAbierto = await this.#o.navegadorPara(conectado);
      return { navegador: this.#navegadorAbierto };
    } catch {
      return {};
    }
  }

  async #reprogramar(sitio: SitioVigilado, enMs: number, chequeo: Chequeo | null): Promise<void> {
    await this.#o.vigilancia
      .guardar({
        siteId: sitio.siteId,
        workerId: this.#o.workerId,
        estado: sitio.estado,
        chequeo,
        proximaEnMs: enMs,
      })
      .catch(() => {});
  }
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** «vox-legal.com» en vez de «https://vox-legal.com/»: es como la llama su dueño. */
function nombreLegible(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
