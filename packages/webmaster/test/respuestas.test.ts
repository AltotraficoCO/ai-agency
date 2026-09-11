import { describe, expect, it } from "vitest";
import { HERRAMIENTAS_WEBMASTER, quitarRazonamiento, webmaster } from "../src/index.js";

describe("lo que el cliente lee", () => {
  it("quita el razonamiento del modelo, también con la etiqueta de apertura recortada", () => {
    // El caso real: GLM devolvió el borrador, un </think> suelto y la respuesta repetida.
    const crudo =
      "Entiendo que el sistema exige URL relativas. ¿Te parece bien?</think>Puedo añadir el enlace. RESUMEN: listo.";
    expect(quitarRazonamiento(crudo)).toBe("Puedo añadir el enlace. RESUMEN: listo.");
    expect(quitarRazonamiento("<think>pensando…</think>RESUMEN: hecho.")).toBe("RESUMEN: hecho.");
    expect(quitarRazonamiento("RESUMEN: sin razonamiento.")).toBe("RESUMEN: sin razonamiento.");
  });

  it("el prompt prohíbe cerrar con una pregunta y ofrece pedir_aprobacion", () => {
    const p = webmaster.prompt({ agentName: "Max", siteUrl: "https://ejemplo.com", modoSimulacion: false });
    expect(p).toContain("pedir_aprobacion");
    expect(p).toContain("NUNCA termines tu respuesta con una pregunta");
  });
});

describe("pedir_aprobacion", () => {
  it("existe y la corta el AI SDK antes de ejecutarse", () => {
    const herramienta = HERRAMIENTAS_WEBMASTER.find((t) => t.slug === "pedir_aprobacion");
    expect(herramienta?.sensitive).toBe(true);
  });
});

describe("enlaces del header y footer global", () => {
  const header = HERRAMIENTAS_WEBMASTER.find((t) => t.slug === "wp_crear_header_global");
  const entrada = (url: string) => ({
    marca: "Negocio",
    enlaces: [
      { texto: "Inicio", url: "/" },
      { texto: "Enlace", url },
    ],
  });

  it("acepta rutas del sitio y direcciones externas completas", () => {
    for (const url of ["/contacto/", "https://www.google.com", "mailto:hola@negocio.com", "tel:+57 300 123 4567"]) {
      expect(header?.inputSchema.safeParse(entrada(url)).success, url).toBe(true);
    }
  });

  it("rechaza lo que no es un enlace válido", () => {
    for (const url of ["www.google.com", "javascript:alert(1)", 'https://x.com" onclick="alert(1)']) {
      expect(header?.inputSchema.safeParse(entrada(url)).success, url).toBe(false);
    }
  });
});
