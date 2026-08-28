import { describe, expect, it } from "vitest";
import { formatearRuta, partirEnBloques, trocear, TROCEADO_POR_DEFECTO } from "../src/trocear.js";
import { estimarTokens } from "../src/texto.js";

/** Genera prosa de aproximadamente `tokens` tokens estimados. */
function prosa(tokens: number, semilla = "producto"): string {
  const frase = `El ${semilla} de la tienda se entrega en veinticuatro horas en toda la ciudad. `;
  const porFrase = estimarTokens(frase);
  return frase.repeat(Math.max(1, Math.ceil(tokens / porFrase))).trim();
}

function tabla(filas: number): string {
  const lineas = ["| Producto | Precio | Stock |", "| --- | --- | --- |"];
  for (let i = 0; i < filas; i++) lineas.push(`| Silla modelo ${i} | ${100 + i}.000 | ${i} |`);
  return lineas.join("\n");
}

function lista(elementos: number): string {
  return Array.from({ length: elementos }, (_, i) => `- Punto número ${i} de la política de devoluciones vigente`).join("\n");
}

describe("troceado semántico", () => {
  it("nunca parte una tabla entre dos trozos", () => {
    const md = `# Catálogo\n\n${prosa(800)}\n\n## Precios\n\n${tabla(40)}\n\n${prosa(800, "envío")}`;
    const trozos = trocear(md);

    const conTabla = trozos.filter((t) => t.texto.includes("| Producto | Precio | Stock |"));
    expect(conTabla).toHaveLength(1);
    // La tabla aparece completa: primera y última fila en el mismo trozo.
    const soloUno = conTabla[0]!;
    expect(soloUno.texto).toContain("Silla modelo 0");
    expect(soloUno.texto).toContain("Silla modelo 39");
    // Y ningún otro trozo contiene filas sueltas de la tabla.
    for (const t of trozos) {
      if (t === soloUno) continue;
      expect(t.texto).not.toMatch(/^\|\s*Silla modelo/m);
    }
  });

  it("nunca parte una lista entre dos trozos", () => {
    const md = `# Políticas\n\n${prosa(800)}\n\n## Devoluciones\n\n${lista(30)}\n\n${prosa(800, "garantía")}`;
    const trozos = trocear(md);
    const conLista = trozos.filter((t) => t.texto.includes("Punto número 0 "));
    expect(conLista).toHaveLength(1);
    expect(conLista[0]!.texto).toContain("Punto número 29");
  });

  it("antepone la ruta de encabezados al texto indexado", () => {
    const md = "# Precios\n\n## Plan Pro\n\nCuesta noventa mil pesos al mes e incluye soporte.";
    const [trozo] = trocear(md);
    expect(trozo).toBeDefined();
    expect(trozo!.rutaEncabezados).toEqual(["Precios", "Plan Pro"]);
    expect(trozo!.contenido.startsWith("Precios > Plan Pro")).toBe(true);
    // El texto que se le enseña a una persona no lleva el prefijo.
    expect(trozo!.texto.startsWith("Precios > Plan Pro")).toBe(false);
  });

  it("respeta el objetivo de 700-900 tokens salvo con bloques indivisibles", () => {
    const md = Array.from({ length: 12 }, (_, i) => `## Sección ${i}\n\n${prosa(400, `tema${i}`)}`).join("\n\n");
    const trozos = trocear(md);
    expect(trozos.length).toBeGreaterThan(2);
    for (const t of trozos.slice(0, -1)) {
      expect(t.tokensEstimados).toBeLessThanOrEqual(TROCEADO_POR_DEFECTO.objetivoMaximo * 1.6);
    }
  });

  it("solapa contenido entre trozos consecutivos", () => {
    const md = Array.from({ length: 10 }, (_, i) => `Párrafo ${i}. ${prosa(200, `p${i}`)}`).join("\n\n");
    const trozos = trocear(md);
    expect(trozos.length).toBeGreaterThan(1);
    const primero = trozos[0]!;
    const segundo = trozos[1]!;
    const colaPrimero = primero.texto.slice(-60);
    expect(segundo.texto.includes(colaPrimero.trim().slice(0, 30))).toBe(true);
  });

  it("un mismo contenido produce siempre los mismos hashes", () => {
    const md = `# A\n\n${prosa(500)}\n\n# B\n\n${tabla(5)}`;
    const a = trocear(md).map((t) => t.hash);
    const b = trocear(md).map((t) => t.hash);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("parte en bloques atómicos: la lista y la tabla son un bloque cada una", () => {
    const bloques = partirEnBloques(`# T\n\n${lista(4)}\n\n${tabla(3)}\n\ntexto suelto`);
    expect(bloques.map((b) => b.tipo)).toEqual(["encabezado", "lista", "tabla", "parrafo"]);
  });

  it("formatea la ruta como la ve el cliente", () => {
    expect(formatearRuta(["Precios", "Plan Pro"])).toBe("Precios > Plan Pro");
    expect(formatearRuta([])).toBe("");
  });

  it("parte una tabla gigantesca repitiendo la cabecera, como último recurso", () => {
    const trozos = trocear(tabla(900));
    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) expect(t.texto).toContain("| Producto | Precio | Stock |");
  });
});
