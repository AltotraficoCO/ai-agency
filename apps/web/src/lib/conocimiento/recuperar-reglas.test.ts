import { describe, expect, it } from "vitest";
import {
  ESPERA_REINTENTO_AUTOMATICO_MS,
  esFalloRecuperable,
  sePuedeReleer,
  tocaReintentoAutomatico,
  type FuenteFallida,
} from "./recuperar-reglas";

const ERROR_VIEJO =
  "AI Gateway authentication failed: No authentication provided.\n\nOption 1 - API key:\nCreate an API key: https://vercel.com/d?to=...";

function fuente(parcial: Partial<FuenteFallida> = {}): FuenteFallida {
  return {
    id: "f1",
    cerebroId: "c1",
    kind: "url",
    status: "error",
    titulo: "Mi web",
    uri: "https://tunegocio.com",
    tieneContenido: false,
    errorDetail: ERROR_VIEJO,
    metadata: {},
    ...parcial,
  };
}

describe("qué fallos son del proveedor y no de la fuente", () => {
  it("reconoce el error viejo en inglés del gateway", () => {
    expect(esFalloRecuperable(fuente())).toBe(true);
  });

  it("reconoce el detalle ya traducido", () => {
    expect(
      esFalloRecuperable(
        fuente({
          errorDetail:
            "No pudimos preparar la búsqueda inteligente. Vuelve a leer la fuente: se guardará para buscar por palabras.",
        }),
      ),
    ).toBe(true);
  });

  it("una dirección que no existe no es culpa del proveedor", () => {
    expect(
      esFalloRecuperable(
        fuente({ errorDetail: "No pudimos leer esa dirección. Revisa que esté bien escrita y que la página esté publicada." }),
      ),
    ).toBe(false);
  });

  it("solo cuenta lo que está en error", () => {
    expect(esFalloRecuperable(fuente({ status: "stale" }))).toBe(false);
  });
});

describe("qué se puede volver a aprender", () => {
  it("una página con dirección, sí", () => {
    expect(sePuedeReleer(fuente())).toEqual({ releible: true });
  });

  it("un sitio completo con la dirección en metadata, sí", () => {
    expect(sePuedeReleer(fuente({ kind: "sitemap", uri: null, metadata: { sitio: "https://x.com" } }))).toEqual({
      releible: true,
    });
  });

  it("un texto de Strap sin contenido guardado, no: se pide pegarlo otra vez", () => {
    const r = sePuedeReleer(fuente({ kind: "text", uri: null, tieneContenido: false }));
    expect(r.releible).toBe(false);
    if (!r.releible) expect(r.motivo).toMatch(/pegar/);
  });

  it("un archivo con su texto guardado, sí; sin él, se pide subirlo", () => {
    expect(sePuedeReleer(fuente({ kind: "file", tieneContenido: true }))).toEqual({ releible: true });
    const r = sePuedeReleer(fuente({ kind: "file", tieneContenido: false }));
    expect(r.releible).toBe(false);
  });

  it("un PDF escaneado no se reintenta: daría lo mismo", () => {
    const r = sePuedeReleer(
      fuente({
        kind: "file",
        status: "stale",
        tieneContenido: true,
        errorDetail: "Este PDF parece escaneado: no tiene texto que leer.",
      }),
    );
    expect(r.releible).toBe(false);
  });
});

describe("reintento automático sin bucles", () => {
  const ahora = Date.parse("2026-09-11T20:00:00Z");

  it("reintenta un fallo del proveedor que nunca se reintentó", () => {
    expect(tocaReintentoAutomatico(fuente(), ahora)).toBe(true);
  });

  it("no repite si ya se reintentó hace menos de un día", () => {
    const hace1h = new Date(ahora - 60 * 60 * 1000).toISOString();
    expect(tocaReintentoAutomatico(fuente({ metadata: { reintentoAutomatico: hace1h } }), ahora)).toBe(false);
  });

  it("vuelve a intentarlo pasado el día", () => {
    const antes = new Date(ahora - ESPERA_REINTENTO_AUTOMATICO_MS - 1000).toISOString();
    expect(tocaReintentoAutomatico(fuente({ metadata: { reintentoAutomatico: antes } }), ahora)).toBe(true);
  });

  it("no toca fallos que no son del proveedor", () => {
    expect(tocaReintentoAutomatico(fuente({ errorDetail: "No pudimos leer esa dirección." }), ahora)).toBe(false);
  });
});
