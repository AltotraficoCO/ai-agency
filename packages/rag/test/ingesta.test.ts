import { describe, expect, it } from "vitest";
import { htmlAMarkdown } from "../src/ingest/html.js";
import { parsearRobots, permiteRuta } from "../src/ingest/robots.js";
import { rastrearSitio } from "../src/ingest/web.js";
import { csvAMarkdown, detectarFormato, ingerirArchivo, ingerirTexto, parsearCsv } from "../src/ingest/archivos.js";
import { fetchFalso } from "./dobles.js";

const PAGINA = `<!doctype html><html><head><title>Tienda Norte · Precios</title>
<script>window.dataLayer=[{"precio":0}]</script><style>.x{color:red}</style></head>
<body>
<nav class="navbar"><a href="/">Inicio</a><a href="/contacto">Contacto</a></nav>
<div class="cookie-banner">Usamos cookies</div>
<main>
  <h1>Precios</h1>
  <p>Nuestros planes para <strong>empresas peque&ntilde;as</strong>.</p>
  <h2>Plan Pro</h2>
  <ul><li>Soporte prioritario</li><li>Usuarios ilimitados</li></ul>
  <table><tr><th>Plan</th><th>Precio</th></tr><tr><td>Pro</td><td>90.000</td></tr></table>
  <p>Escr&iacute;benos a <a href="/contacto">contacto</a>.</p>
</main>
<footer class="site-footer"><p>Todos los derechos reservados 2026</p></footer>
</body></html>`;

describe("html a markdown", () => {
  const { titulo, markdown, enlaces } = htmlAMarkdown(PAGINA, "https://tienda.co/precios");

  it("saca el título de la página", () => {
    expect(titulo).toBe("Tienda Norte · Precios");
  });

  it("tira navegación, pie, cookies, scripts y estilos", () => {
    expect(markdown).not.toContain("Inicio");
    expect(markdown).not.toContain("Usamos cookies");
    expect(markdown).not.toContain("derechos reservados");
    expect(markdown).not.toContain("dataLayer");
    expect(markdown).not.toContain("color:red");
  });

  it("conserva encabezados, listas y tablas como markdown", () => {
    expect(markdown).toContain("# Precios");
    expect(markdown).toContain("## Plan Pro");
    expect(markdown).toContain("- Soporte prioritario");
    expect(markdown).toContain("| Plan | Precio |");
    expect(markdown).toContain("| Pro | 90.000 |");
  });

  it("decodifica entidades del castellano", () => {
    expect(markdown).toContain("pequeñas");
    expect(markdown).toContain("Escríbenos");
  });

  it("devuelve enlaces absolutos para el rastreo", () => {
    expect(enlaces).toContain("https://tienda.co/contacto");
  });
});

describe("robots.txt", () => {
  const reglas = parsearRobots(
    ["User-agent: *", "Disallow: /admin", "Disallow: /carrito", "Allow: /admin/publico", "Sitemap: https://tienda.co/sitemap.xml"].join("\n"),
  );

  it("lee sitemaps y reglas", () => {
    expect(reglas.sitemaps).toEqual(["https://tienda.co/sitemap.xml"]);
    expect(reglas.prohibir).toContain("/admin");
  });

  it("prohíbe lo prohibido y permite lo demás", () => {
    expect(permiteRuta(reglas, "https://tienda.co/precios")).toBe(true);
    expect(permiteRuta(reglas, "https://tienda.co/admin/usuarios")).toBe(false);
    // La regla más específica gana: Allow sobre Disallow.
    expect(permiteRuta(reglas, "https://tienda.co/admin/publico")).toBe(true);
  });

  it("un grupo dirigido a nuestro agente gana al comodín", () => {
    const r = parsearRobots(["User-agent: *", "Disallow: /", "User-agent: StrappyBot", "Disallow: /privado"].join("\n"), "strappybot");
    expect(permiteRuta(r, "/precios")).toBe(true);
    expect(permiteRuta(r, "/privado")).toBe(false);
  });
});

describe("rastreo web", () => {
  const cuerpo = (titulo: string, enlaces: string[]): string =>
    `<html><head><title>${titulo}</title></head><body><main><h1>${titulo}</h1><p>${"Contenido suficiente de la página para que valga la pena indexarla. ".repeat(4)}</p>${enlaces
      .map((e) => `<a href="${e}">ir</a>`)
      .join("")}</main></body></html>`;

  it("prefiere el sitemap cuando existe", async () => {
    const fetch = fetchFalso({
      "https://tienda.co/robots.txt": { body: "User-agent: *\nSitemap: https://tienda.co/sitemap.xml", contentType: "text/plain" },
      "https://tienda.co/sitemap.xml": {
        body: "<urlset><url><loc>https://tienda.co/a</loc></url><url><loc>https://tienda.co/b</loc></url></urlset>",
        contentType: "application/xml",
      },
      "https://tienda.co/a": { body: cuerpo("Página A", []) },
      "https://tienda.co/b": { body: cuerpo("Página B", []) },
    });
    const r = await rastrearSitio(fetch, "https://tienda.co/");
    expect(r.metodo).toBe("sitemap");
    expect(r.paginas.map((p) => p.documento.titulo).sort()).toEqual(["Página A", "Página B"]);
  });

  it("sin sitemap rastrea en anchura sin salirse del dominio", async () => {
    const fetch = fetchFalso({
      "https://tienda.co/robots.txt": { body: "", status: 404 },
      "https://tienda.co/sitemap.xml": { body: "", status: 404 },
      "https://tienda.co/": { body: cuerpo("Inicio", ["/precios", "https://facebook.com/tienda", "/envios"]) },
      "https://tienda.co/precios": { body: cuerpo("Precios", ["/"]) },
      "https://tienda.co/envios": { body: cuerpo("Envíos", []) },
    });
    const r = await rastrearSitio(fetch, "https://tienda.co/");
    expect(r.metodo).toBe("rastreo");
    expect(r.paginas.map((p) => p.url).sort()).toEqual([
      "https://tienda.co/",
      "https://tienda.co/envios",
      "https://tienda.co/precios",
    ]);
    expect(fetch.pedidas).not.toContain("https://facebook.com/tienda");
  });

  it("no pasa de 50 páginas", async () => {
    const paginas: Record<string, { body: string }> = {};
    const enlaces = Array.from({ length: 120 }, (_, i) => `/p${i}`);
    paginas["https://tienda.co/"] = { body: cuerpo("Inicio", enlaces) };
    for (const e of enlaces) paginas[`https://tienda.co${e}`] = { body: cuerpo(`Página ${e}`, enlaces) };
    const fetch = fetchFalso(paginas);
    const r = await rastrearSitio(fetch, "https://tienda.co/");
    expect(r.paginas.length).toBe(50);
    expect(r.topeAlcanzado).toBe(true);
  });

  it("respeta robots.txt al rastrear", async () => {
    const fetch = fetchFalso({
      "https://tienda.co/robots.txt": { body: "User-agent: *\nDisallow: /carrito", contentType: "text/plain" },
      "https://tienda.co/sitemap.xml": { body: "", status: 404 },
      "https://tienda.co/": { body: cuerpo("Inicio", ["/carrito", "/precios"]) },
      "https://tienda.co/precios": { body: cuerpo("Precios", []) },
      "https://tienda.co/carrito": { body: cuerpo("Carrito", []) },
    });
    const r = await rastrearSitio(fetch, "https://tienda.co/");
    expect(fetch.pedidas).not.toContain("https://tienda.co/carrito");
    expect(r.paginas.map((p) => p.url)).not.toContain("https://tienda.co/carrito");
  });
});

describe("archivos", () => {
  it("detecta el formato por extensión y por mime", () => {
    expect(detectarFormato("catalogo.pdf")).toBe("pdf");
    expect(detectarFormato("hoja.CSV")).toBe("csv");
    expect(detectarFormato("nota", "text/plain")).toBe("texto");
    expect(detectarFormato("contrato.docx")).toBe("docx");
  });

  it("convierte CSV a una tabla markdown que el troceado no partirá", async () => {
    const doc = await ingerirArchivo({ nombre: "precios.csv", texto: "Producto,Precio\nSilla,\"89.000\"\nMesa,120.000" });
    expect(doc.markdown).toContain("| Producto | Precio |");
    expect(doc.markdown).toContain("| Silla | 89.000 |");
  });

  it("parsea CSV con comillas y separadores raros", () => {
    expect(parsearCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
    expect(csvAMarkdown("a;b\n1;2")).toContain("| a | b |");
  });

  it("un PDF sin texto se marca para revisión, no falla en silencio", async () => {
    const doc = await ingerirArchivo(
      { nombre: "catalogo-escaneado.pdf", bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" },
      { extraer: async () => ({ markdown: "  \n \n", paginas: 12 }) },
    );
    expect(doc.necesitaOcr).toBe(true);
    expect(doc.metadata?.["paginas"]).toBe(12);
  });

  it("un PDF con texto pasa como documento normal", async () => {
    const doc = await ingerirArchivo(
      { nombre: "manual.pdf", bytes: new Uint8Array([1]), mimeType: "application/pdf" },
      { extraer: async () => ({ markdown: "# Manual\n\nEste manual explica cómo devolver un producto en menos de treinta días." }) },
    );
    expect(doc.necesitaOcr).toBe(false);
    expect(doc.markdown).toContain("# Manual");
  });

  it("sin extractor, un PDF falla con un mensaje que se le puede enseñar al cliente", async () => {
    await expect(ingerirArchivo({ nombre: "x.pdf", bytes: new Uint8Array([1]) })).rejects.toThrow(/extractor de documentos/);
  });

  it("el texto pegado recibe un encabezado con su título", () => {
    const doc = ingerirTexto({ titulo: "Horarios", texto: "Abrimos de lunes a viernes de 8 a 6." });
    expect(doc.markdown.startsWith("# Horarios")).toBe(true);
    expect(doc.tipo).toBe("text");
  });
});
