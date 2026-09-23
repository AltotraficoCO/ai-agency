/**
 * Navegador real con Playwright: la implementación del `BrowserPort`.
 *
 * Es opcional a propósito. `playwright-core` no es dependencia del paquete
 * porque el navegador pesa cientos de megabytes y no todo despliegue lo
 * necesita; se carga por especificador dinámico y, si no está, el error dice
 * exactamente qué instalar en vez de reventar con un módulo no encontrado.
 *
 * Dos reglas heredadas del original, ambas por incidentes reales:
 *  - La sesión es única y persiste toda la tarea, como un visitante que va
 *    navegando: verificar un menú exige haber cargado la página anterior.
 *  - Después de cada acción se comprueba que el navegador siga en el dominio
 *    del cliente. Un enlace externo en el sitio no puede convertir al agente
 *    en un navegador de propósito general dentro de la red del servidor.
 */
import type { BrowserPort, CapturaPantalla, WpCreds, ConectorCreds, MuestrasDiseno } from "../ports.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cualquiera = any;

/**
 * Se ejecuta DENTRO de la página. Va como texto para no arrastrar los tipos
 * del DOM al paquete. Mide solo el contenido: el header y el footer tienen su
 * propio diseño y no dicen cómo es una sección de la página.
 */
export const SCRIPT_MUESTREO = `(() => {
  const vw = window.innerWidth;
  const FUERA = 'header, footer, nav, #wpadminbar, [data-elementor-type="header"], [data-elementor-type="footer"], .elementor-location-header, .elementor-location-footer';
  const fuera = (el) => !!el.closest(FUERA);
  const caja = (el) => el.getBoundingClientRect();
  const visible = (el) => { const r = caja(el); return r.width > 4 && r.height > 4; };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
  const todos = (sel, max) => Array.from(document.querySelectorAll(sel)).filter((e) => !fuera(e) && visible(e)).slice(0, max);
  const texto = (el) => (el.textContent || '').trim().length;
  const titulos = [], parrafos = [], botones = [], cajas = [], anchos = [];
  for (const el of todos('h1, h2, h3, h4', 150)) {
    const s = getComputedStyle(el);
    titulos.push({ etiqueta: el.tagName.toLowerCase(), color: s.color, familia: s.fontFamily, grosor: s.fontWeight, tamano: num(s.fontSize), alineacion: s.textAlign, peso: Math.min(texto(el), 120) || 1 });
  }
  for (const el of todos('p, li', 300)) {
    if (!texto(el) || el.closest('a, button')) continue;
    const s = getComputedStyle(el);
    parrafos.push({ etiqueta: 'p', color: s.color, familia: s.fontFamily, grosor: s.fontWeight, tamano: num(s.fontSize), peso: Math.min(texto(el), 400) });
  }
  for (const el of todos('.elementor-button, .elementor-slide-button, a.button, button, input[type=submit], .wp-block-button__link', 80)) {
    const s = getComputedStyle(el); const r = caja(el);
    botones.push({ fondo: s.backgroundColor, texto: s.color, radio: num(s.borderTopLeftRadius), alto: r.height, relleno_v: num(s.paddingTop), relleno_h: num(s.paddingLeft), familia: s.fontFamily, peso: 1 });
  }
  for (const el of todos('.e-con, .elementor-section, .elementor-column, .elementor-widget-wrap, .elementor-element, .elementor-background-overlay, section, article', 2000)) {
    const s = getComputedStyle(el); const r = caja(el);
    const fondo = s.backgroundColor; const radio = num(s.borderTopLeftRadius) || 0;
    const conFondo = fondo && fondo !== 'rgba(0, 0, 0, 0)' && fondo !== 'transparent';
    if (!conFondo && radio <= 0) continue;
    if (r.width >= vw - 2 && r.height > 4000) continue;
    cajas.push({ fondo: conFondo ? fondo : undefined, radio, area: Math.round(r.width * r.height / 1000) || 1 });
  }
  for (const el of todos('.e-con-inner, .elementor-container', 300)) {
    const w = caja(el).width;
    if (w > 0 && w < vw - 30) anchos.push(Math.round(w));
  }
  return { titulos, parrafos, botones, cajas, anchos, fondo_pagina: getComputedStyle(document.body).backgroundColor };
})()`;

export type OpcionesNavegador = {
  /** Base del sitio del cliente. Es la frontera: no se sale de aquí. */
  readonly baseUrl: string;
  /** Ruta a un Chrome concreto; sin ella se usa el canal "chrome". */
  readonly chromePath?: string;
  readonly viewport?: { width: number; height: number };
};

export function baseDeSitio(creds: { wp?: WpCreds; conector?: ConectorCreds }): string {
  if (creds.wp) {
    const u = creds.wp.url.replace(/\/+$/, "");
    return u.startsWith("http") ? u : `https://${u}`;
  }
  if (creds.conector) {
    return creds.conector.baseUrl.replace(/\/(api\/)?[a-z]+\/v\d+\/?$/, "").replace(/\/+$/, "");
  }
  throw new Error("No hay sitio al que apuntar el navegador.");
}

export async function crearNavegadorPlaywright(o: OpcionesNavegador): Promise<BrowserPort> {
  const especificador = "playwright-core";
  let chromium: Cualquiera;
  try {
    ({ chromium } = (await import(especificador)) as Cualquiera);
  } catch {
    throw new Error(
      "Este worker no tiene navegador: instala `playwright-core` y un Chrome para poder verificar visualmente los cambios.",
    );
  }

  const consola: string[] = [];

  let browser: Cualquiera = null;
  let page: Cualquiera = null;

  /**
   * Abre un Chrome nuevo con su página. Se puede llamar más de una vez: es lo
   * que permite resucitar la sesión si el navegador se muere a mitad.
   */
  const lanzar = async (): Promise<void> => {
    browser = await chromium.launch({
      headless: true,
      ...(o.chromePath ? { executablePath: o.chromePath } : { channel: "chrome" }),
    });
    page = await browser.newPage({
      viewport: o.viewport ?? { width: 1280, height: 900 },
    });
    page.on("pageerror", (e: Cualquiera) => consola.push(`[error] ${String(e.message).slice(0, 160)}`));
    page.on("console", (m: Cualquiera) => {
      const tipo = m.type();
      if (tipo === "error" || tipo === "warning") {
        consola.push(`[${tipo}] ${String(m.text()).slice(0, 160)}`);
      }
    });
  };

  await lanzar();

  /**
   * Que la sesión esté viva antes de cada acción, y si no, otra.
   *
   * Un encargo del Webmaster dura minutos y usa el MISMO Chrome de principio a
   * fin. Si ese Chrome se muere por lo que sea —un despliegue que reescribe
   * node_modules debajo, una pestaña que se lleva la memoria, el proceso que
   * se cae— todas las llamadas siguientes fallaban igual con «Target page,
   * context or browser has been closed», el modelo las repetía y el freno de
   * repeticiones daba el encargo por perdido. Pasó de verdad el 22-sep con el
   * blog de Vox. Abrir otro Chrome cuesta un segundo; perder el encargo cuesta
   * el encargo.
   */
  const vivo = (): boolean => {
    try {
      return Boolean(browser?.isConnected()) && !page?.isClosed();
    } catch {
      return false;
    }
  };

  const esSesionMuerta = (e: unknown): boolean =>
    /(target|browser|context|page).{0,30}(closed|crash)|session closed|disconnected/i.test(
      e instanceof Error ? e.message : String(e),
    );

  /**
   * Corre una acción del navegador y, si lo que falló fue la sesión y no el
   * sitio, la repite UNA vez sobre un Chrome nuevo. Una sola vez: si el
   * segundo también muere, el problema no es la sesión y hay que decirlo.
   */
  const conSesion = async <T>(accion: () => Promise<T>): Promise<T> => {
    if (!vivo()) await lanzar();
    try {
      return await accion();
    } catch (error) {
      if (!esSesionMuerta(error)) throw error;
      await browser?.close().catch(() => {});
      await lanzar();
      return await accion();
    }
  };

  const host = new URL(o.baseUrl).host;

  /** Si la acción salió del dominio del cliente, vuelve y lo cuenta. */
  const contener = async (): Promise<string | undefined> => {
    try {
      if (new URL(page.url()).host !== host) {
        const fuera = String(page.url());
        await page.goto(o.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
        return `la acción intentó salir del sitio (${fuera.slice(0, 80)}); volví al dominio del cliente`;
      }
    } catch {
      /* si ni siquiera se puede leer la URL, la captura siguiente lo dirá */
    }
    return undefined;
  };

  const capturar = async (completa = false): Promise<CapturaPantalla> => {
    const shot: Buffer = await page.screenshot({
      type: "jpeg",
      quality: 55,
      fullPage: completa,
    });
    return {
      base64: shot.toString("base64"),
      mimeType: "image/jpeg",
      url: String(page.url()),
      titulo: String(await page.title()),
    };
  };

  /**
   * Abrir una página sin que un sitio «raro» tumbe la mirada.
   *
   * Esperar a «sin red» es lo que da la captura más fiel, pero Chromium aborta
   * la navegación (net::ERR_ABORTED) si el sitio redirige o un script cambia
   * la dirección mientras carga, y algunos sitios nunca quedan sin red por
   * culpa de un chat o de la analítica. En cualquiera de esos casos se
   * reintenta una vez con un criterio más laxo. Si ni así, se dice claro: el
   * agente sigue trabajando por la API de WordPress, que no la frena ningún
   * cortafuegos ni protección contra robots; el navegador solo sirve para mirar.
   */
  const abrir = async (path: string): Promise<Cualquiera> => {
    const url = `${o.baseUrl}${path}`;
    try {
      return await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      try {
        return await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
      } catch {
        throw new Error(
          `No pude abrir ${url} en el navegador (${motivo.split("\n")[0]?.slice(0, 120)}). ` +
            "Puede que el sitio redirija, bloquee navegadores automáticos o tarde demasiado. " +
            "Sigue por la API de WordPress: lo que cambies ahí se aplica igual.",
        );
      }
    }
  };

  return {
    ir(path, paginaCompleta) {
      return conSesion(async () => {
        const res = await abrir(path);
        return {
          ...(await capturar(paginaCompleta)),
          status: res?.status() ?? null,
        };
      });
    },

    click(objetivo) {
      return conSesion(async () => {
        const loc = objetivo.selector
          ? page.locator(objetivo.selector).first()
          : page.getByText(objetivo.texto ?? "", { exact: false }).first();
        await loc.click({ timeout: 10_000 });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        const nota = await contener();
        return { ...(await capturar()), ...(nota ? { nota } : {}) };
      });
    },

    escribir({ selector, texto, enviar }) {
      return conSesion(async () => {
        const campo = page.locator(selector).first();
        await campo.fill(texto, { timeout: 10_000 });
        if (enviar) {
          await campo.press("Enter");
          await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        }
        const nota = await contener();
        return { ...(await capturar()), ...(nota ? { nota } : {}) };
      });
    },

    leer(selector) {
      return conSesion(async () => {
        const loc = selector ? page.locator(selector).first() : page.locator("body");
        return {
          url: String(page.url()),
          texto: String(await loc.innerText({ timeout: 10_000 })),
        };
      });
    },

    async consola() {
      return {
        url: vivo() ? String(page.url()) : o.baseUrl,
        consola: consola.slice(-40),
      };
    },

    muestrearDiseno(path) {
      return conSesion(async () => {
        await abrir(path);
        await contener();
        // Bajar y volver: las secciones con animación o carga diferida no tienen
        // estilo final hasta que entran en pantalla.
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)").catch(() => {});
        await page.waitForTimeout(700);
        await page.evaluate("window.scrollTo(0, 0)").catch(() => {});
        return (await page.evaluate(SCRIPT_MUESTREO)) as MuestrasDiseno;
      });
    },

    async cerrar() {
      await browser.close().catch(() => {});
    },
  };
}
