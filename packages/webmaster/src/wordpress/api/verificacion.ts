/**
 * Verificación por HTTP y caché del sitio.
 */
import type { WpCreds } from "../../ports.js";
import { type WpClientOptions, baseUrl, señal, wp } from "./http.js";
import type { TipoContenido } from "./tipos.js";
import { listarPlugins } from "./lectura.js";

export async function verificar(
  c: WpCreds,
  path: string,
  contiene: string | undefined,
  o: WpClientOptions = {},
): Promise<{ ok: boolean; status: number; encontrado?: boolean; ms: number }> {
  const f = o.fetch ?? globalThis.fetch;
  const t0 = Date.now();
  const res = await f(`${baseUrl(c)}${path}`, {
    signal: señal(15_000, o.abortSignal),
    // Sin esto se verifica la copia cacheada y el cambio "no aparece".
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
  const ms = Date.now() - t0;
  if (!contiene) return { ok: res.ok, status: res.status, ms };
  const html = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    encontrado: html.toLowerCase().includes(contiene.toLowerCase()),
    ms,
  };
}

/** Plugins de caché que sirven HTML guardado y tapan un cambio ya aplicado. */
const PLUGINS_DE_CACHE =
  /litespeed|wp-rocket|w3-total-cache|wp-super-cache|wp-fastest-cache|autoptimize|hummingbird|nitropack|swift-performance|cache-enabler|breeze/i;

/**
 * Por qué existe esto.
 *
 * El 22-sep el Webmaster dejó el título puesto en la plantilla del blog de un
 * cliente, lo releyó, lo vio guardado… y la página seguía igual. El sitio tenía
 * LiteSpeed Cache con siete días de vida, así que servía HTML de antes. El
 * agente lo interpretó como que su cambio no había funcionado: lo borró, lo
 * volvió a poner de otra forma y se quedó sin acciones. Tres encargos seguidos.
 *
 * Purgar de verdad no se puede por la API: LiteSpeed no publica ninguna ruta
 * REST para ello (comprobado contra el sitio real). Lo que sí funciona en
 * cualquier plugin de caché es TOCAR el contenido: al volver a guardarlo,
 * WordPress dispara `save_post` y el plugin invalida esa URL, que es
 * exactamente lo que hace cuando una persona pulsa «Actualizar».
 */
export async function refrescarCacheDelSitio(
  c: WpCreds,
  input: { tipo: TipoContenido; id: number },
  o: WpClientOptions = {},
): Promise<{ elementor: boolean; tocado: boolean; plugins: readonly string[] }> {
  let elementor = false;
  try {
    const limpiar = await wp(c, o, "/elementor/v1/cache", { method: "DELETE" });
    elementor = limpiar.ok;
  } catch {
    /* es un extra: sin ella el cambio sigue guardado */
  }

  // Se reescribe el título por el MISMO título: no cambia nada del contenido y
  // dispara el guardado, que es lo único que los plugins de caché escuchan.
  let tocado = false;
  try {
    const actual = await wp(c, o, `/wp/v2/${input.tipo}s/${input.id}?context=edit&_fields=title`);
    if (actual.ok) {
      const cuerpo = (await actual.json()) as { title?: { raw?: string; rendered?: string } };
      const titulo = cuerpo.title?.raw ?? cuerpo.title?.rendered ?? "";
      const guardado = await wp(c, o, `/wp/v2/${input.tipo}s/${input.id}`, {
        method: "POST",
        body: JSON.stringify({ title: titulo }),
      });
      tocado = guardado.ok;
    }
  } catch {
    /* si no se deja tocar, se dice que no y ya */
  }

  const plugins = (await listarPlugins(c, o))
    .filter((p) => p.status === "active" && PLUGINS_DE_CACHE.test(p.plugin ?? ""))
    .map((p) => p.name ?? p.plugin ?? "")
    .filter(Boolean);

  return { elementor, tocado, plugins };
}
