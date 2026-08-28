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
import type { BrowserPort, CapturaPantalla, WpCreds, ConectorCreds } from "../ports.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cualquiera = any;

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

  const browser: Cualquiera = await chromium.launch({
    headless: true,
    ...(o.chromePath ? { executablePath: o.chromePath } : { channel: "chrome" }),
  });
  const page: Cualquiera = await browser.newPage({
    viewport: o.viewport ?? { width: 1280, height: 900 },
  });

  const consola: string[] = [];
  page.on("pageerror", (e: Cualquiera) => consola.push(`[error] ${String(e.message).slice(0, 160)}`));
  page.on("console", (m: Cualquiera) => {
    const tipo = m.type();
    if (tipo === "error" || tipo === "warning") {
      consola.push(`[${tipo}] ${String(m.text()).slice(0, 160)}`);
    }
  });

  const host = new URL(o.baseUrl).host;

  /** Si la acción salió del dominio del cliente, vuelve y lo cuenta. */
  const contener = async (): Promise<string | undefined> => {
    try {
      if (new URL(page.url()).host !== host) {
        const fuera = String(page.url());
        await page.goto(o.baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
        return `la acción intentó salir del sitio (${fuera.slice(0, 80)}); volví al dominio del cliente`;
      }
    } catch {
      /* si ni siquiera se puede leer la URL, la captura siguiente lo dirá */
    }
    return undefined;
  };

  const capturar = async (completa = false): Promise<CapturaPantalla> => {
    const shot: Buffer = await page.screenshot({ type: "jpeg", quality: 55, fullPage: completa });
    return {
      base64: shot.toString("base64"),
      mimeType: "image/jpeg",
      url: String(page.url()),
      titulo: String(await page.title()),
    };
  };

  return {
    async ir(path, paginaCompleta) {
      const res = await page.goto(`${o.baseUrl}${path}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      return { ...(await capturar(paginaCompleta)), status: res?.status() ?? null };
    },

    async click(objetivo) {
      const loc = objetivo.selector
        ? page.locator(objetivo.selector).first()
        : page.getByText(objetivo.texto ?? "", { exact: false }).first();
      await loc.click({ timeout: 10_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const nota = await contener();
      return { ...(await capturar()), ...(nota ? { nota } : {}) };
    },

    async escribir({ selector, texto, enviar }) {
      const campo = page.locator(selector).first();
      await campo.fill(texto, { timeout: 10_000 });
      if (enviar) {
        await campo.press("Enter");
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      }
      const nota = await contener();
      return { ...(await capturar()), ...(nota ? { nota } : {}) };
    },

    async leer(selector) {
      const loc = selector ? page.locator(selector).first() : page.locator("body");
      return { url: String(page.url()), texto: String(await loc.innerText({ timeout: 10_000 })) };
    },

    async consola() {
      return { url: String(page.url()), consola: consola.slice(-40) };
    },

    async cerrar() {
      await browser.close().catch(() => {});
    },
  };
}
