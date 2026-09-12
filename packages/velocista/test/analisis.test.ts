/**
 * El criterio del agente, que es lo único que de verdad se puede probar.
 *
 * Lo que se verifica aquí no es que compile, sino cuatro promesas al dueño del
 * negocio: que los umbrales son los de Google y no los nuestros, que nunca se
 * le presenta una prueba de laboratorio como si fuera lo que viven sus
 * clientes, que no se le habla en siglas, y que si un cambio no mejoró nada se
 * le dice igual.
 */
import { describe, expect, it } from "vitest";
import {
  BYTES_IMAGEN_PESADA,
  clasificar,
  comparar,
  diagnosticar,
  fraseDeMetrica,
  frenosQueImportan,
  imagenesPesadas,
  peorVeredicto,
  segundos,
  tamano,
  tieneCache,
  titularDe,
  UMBRALES,
} from "../src/analisis.js";
import {
  IMAGENES_DE_EJEMPLO,
  PLUGINS_DE_EJEMPLO,
  medicionLenta,
  medicionRapida,
  medicionSinGenteReal,
} from "../src/testing/dobles.js";

describe("los umbrales son los de Google, no los nuestros", () => {
  it("clasifica el tiempo de carga donde Google corta", () => {
    expect(UMBRALES.lcp).toEqual({ bien: 2500, mal: 4000 });
    expect(clasificar("lcp", 2500)).toBe("bien");
    expect(clasificar("lcp", 2501)).toBe("regular");
    expect(clasificar("lcp", 4000)).toBe("regular");
    expect(clasificar("lcp", 4001)).toBe("mal");
  });

  it("clasifica la respuesta al tocar y el movimiento de la página", () => {
    expect(clasificar("inp", 200)).toBe("bien");
    expect(clasificar("inp", 501)).toBe("mal");
    expect(clasificar("cls", 0.1)).toBe("bien");
    expect(clasificar("cls", 0.26)).toBe("mal");
  });

  it("sin dato no se inventa un veredicto", () => {
    expect(clasificar("inp", undefined)).toBe("sin_datos");
    expect(peorVeredicto({})).toBe("sin_datos");
  });

  it("una página vale lo que su métrica peor: se pasa todo o no se pasa", () => {
    expect(peorVeredicto({ lcp: 1000, inp: 100, cls: 0.02 })).toBe("bien");
    expect(peorVeredicto({ lcp: 1000, inp: 100, cls: 0.9 })).toBe("mal");
    expect(peorVeredicto({ lcp: 3000, inp: 100 })).toBe("regular");
  });
});

describe("cómo se le habla al dueño del negocio", () => {
  it("las frases no llevan una sola sigla", () => {
    const frases = [
      fraseDeMetrica("lcp", 4800),
      fraseDeMetrica("inp", 420),
      fraseDeMetrica("cls", 0.28),
    ].join(" ");
    for (const sigla of ["LCP", "INP", "CLS", "TTFB", "TBT", "Core Web"]) {
      expect(frases).not.toContain(sigla);
    }
  });

  it("los segundos se escriben como se escriben en español", () => {
    expect(segundos(4800)).toBe("4,8 segundos");
    expect(tamano(3_100_000)).toBe("3,0 MB");
    expect(tamano(24_000)).toBe("23 KB");
  });

  it("sin dato, no hay frase: no se rellena con nada", () => {
    expect(fraseDeMetrica("inp", undefined)).toBeNull();
  });
});

describe("de dónde sale cada cifra", () => {
  it("cuando hay gente real, manda la gente real y se dice", () => {
    const d = diagnosticar(medicionLenta());
    expect(d.origen).toBe("campo");
    expect(d.frases.join(" ")).toContain("la gente que entró de verdad");
    expect(titularDe(d)).toContain("va lenta");
  });

  it("sin visitantes suficientes avisa de que es solo una prueba", () => {
    const d = diagnosticar(medicionSinGenteReal());
    expect(d.origen).toBe("laboratorio");
    expect(d.avisos.join(" ")).toContain("no lo que vive tu cliente");
  });

  it("sin gente real no opina de si responde al tocar: eso no se puede medir", () => {
    const d = diagnosticar(medicionSinGenteReal());
    expect(d.frases.join(" ")).not.toContain("responde");
    expect(d.avisos.join(" ")).toContain("solo se mide con gente real");
  });

  it("separa lo que se arregla en la web de lo que es del hosting", () => {
    const d = diagnosticar(medicionLenta());
    const servidor = d.frenos.find((f) => f.clave === "server-response-time");
    expect(servidor?.quienLoArregla).toBe("hosting");
    const imagenes = d.frenos.find((f) => f.clave === "uses-optimized-images");
    expect(imagenes?.quienLoArregla).toBe("nosotros");
    expect(d.avisos.join(" ")).toContain("cosa del hosting");
  });

  it("los frenos se ordenan por el tiempo que se gana, no por su nombre", () => {
    const frenos = frenosQueImportan(medicionLenta().frenos);
    expect(frenos[0]?.clave).toBe("uses-optimized-images");
  });
});

describe("el antes y el después", () => {
  it("cuenta la mejora con las dos cifras", () => {
    const c = comparar(medicionLenta(), medicionRapida());
    expect(c.mejoro).toBe(true);
    expect(c.frase).toContain("4,8 segundos");
    expect(c.frase).toContain("2,1 segundos");
  });

  it("si no cambió nada, lo dice en vez de vender humo", () => {
    const c = comparar(medicionLenta(), medicionLenta());
    expect(c.mejoro).toBe(false);
    expect(c.frase).toContain("prácticamente igual");
  });

  it("si quedó peor, también lo dice", () => {
    const c = comparar(medicionRapida(), medicionLenta());
    expect(c.mejoro).toBe(false);
    expect(c.frase).toContain("más lenta que antes");
  });
});

describe("imágenes y complementos", () => {
  it("encuentra las imágenes pesadas y deja en paz las que están bien", () => {
    const pesadas = imagenesPesadas(IMAGENES_DE_EJEMPLO);
    expect(pesadas.map((i) => i.id)).toEqual([101, 102]);
    expect(pesadas[0]?.motivo).toContain("3,0 MB");
    expect(pesadas[0]?.motivo).toContain("más de lo que se ve en pantalla");
  });

  it("una imagen justo por debajo del límite no se señala", () => {
    const pesadas = imagenesPesadas([
      { id: 1, url: "u", titulo: "casi", bytes: BYTES_IMAGEN_PESADA - 1, mime: "image/webp", ancho: 800 },
    ]);
    expect(pesadas).toHaveLength(0);
  });

  it("detecta que no hay caché activa", () => {
    expect(tieneCache(PLUGINS_DE_EJEMPLO).activo).toBe(false);
    expect(tieneCache([{ slug: "litespeed-cache", activo: true }])).toEqual({
      activo: true,
      cual: "litespeed-cache",
    });
  });
});
