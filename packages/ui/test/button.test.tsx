import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/button.js";

describe("Button", () => {
  it("con asChild renderiza el hijo y le pasa los estilos", () => {
    // El fallo que esto previene: envolver los hijos hacia que Slot recibiera
    // dos y lanzara "Slot failed to slot onto its children".
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="/agentes">Ver agentes</a>
      </Button>,
    );
    expect(html).toContain("<a ");
    expect(html).not.toContain("<button");
    expect(html).toContain('href="/agentes"');
    expect(html).toContain("Ver agentes");
  });

  it("sin asChild sigue siendo un boton", () => {
    const html = renderToStaticMarkup(<Button>Guardar</Button>);
    expect(html).toContain("<button");
    expect(html).toContain("Guardar");
  });

  it("al cargar conserva el contenido para que el ancho no salte", () => {
    const html = renderToStaticMarkup(<Button loading>Guardar cambios</Button>);
    expect(html).toContain("Guardar cambios");
    expect(html).toContain("invisible");
    expect(html).toContain('aria-busy="true"');
  });
});
