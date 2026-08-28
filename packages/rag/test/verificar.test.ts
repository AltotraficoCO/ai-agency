import { describe, expect, it } from "vitest";
import { preguntasHeuristicas, verificarFuente } from "../src/verificar.js";
import { trocear } from "../src/trocear.js";
import { DbFalsa, EmbeddingsFalsos, filaBusqueda } from "./dobles.js";
import type { DocumentoCrudo, FilaBusqueda } from "../src/types.js";

const documento: DocumentoCrudo = {
  tipo: "text",
  titulo: "Políticas",
  markdown: [
    "# Políticas",
    "",
    "## Devoluciones",
    "",
    "Aceptamos devoluciones dentro de los treinta días siguientes a la compra si el producto está sin usar.",
    "",
    "## Garantía",
    "",
    "La garantía cubre defectos de fábrica durante un año contado desde la fecha de la factura.",
    "",
    "## Envíos",
    "",
    "Enviamos a todo el país en un plazo de tres días hábiles con transportadora aliada.",
  ].join("\n"),
};

describe("verificación de calidad tras ingerir", () => {
  const trozos = trocear(documento.markdown);

  it("genera preguntas repartidas por todo el documento", () => {
    const preguntas = preguntasHeuristicas(trozos, 5);
    expect(preguntas.length).toBeGreaterThan(0);
    expect(preguntas.length).toBeLessThanOrEqual(5);
    for (const p of preguntas) expect(p.trim()).not.toBe("");
  });

  it("aprueba cuando la fuente recupera sus propios pedacitos", async () => {
    const db = new DbFalsa();
    const fuente = await db.registrarFuente({ cerebroId: "cerebro-1", titulo: "Políticas" });
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "c1", sourceId: fuente.id, puntuacion: 0.03, distancia: 0.1 }),
    ];
    const r = await verificarFuente(
      { db, embeddings: new EmbeddingsFalsos() },
      { workspaceId: "ws", cerebroId: "cerebro-1", fuenteId: fuente.id, documento, trozos },
    );
    expect(r.acierto).toBe(1);
    expect(r.aprobado).toBe(true);
    expect(db.fuentes.get(fuente.id)?.estado).not.toBe("stale");
  });

  it("por debajo del 80% marca la fuente como «conviene revisar»", async () => {
    const db = new DbFalsa();
    const fuente = await db.registrarFuente({ cerebroId: "cerebro-1", titulo: "Políticas" });
    // Siempre gana otro documento: la fuente recién cargada no es recuperable.
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "otro", sourceId: "fuente-de-otro-documento", puntuacion: 0.03, distancia: 0.1 }),
    ];
    const r = await verificarFuente(
      { db, embeddings: new EmbeddingsFalsos() },
      { workspaceId: "ws", cerebroId: "cerebro-1", fuenteId: fuente.id, documento, trozos },
    );
    expect(r.aprobado).toBe(false);
    expect(r.acierto).toBe(0);
    const guardada = db.fuentes.get(fuente.id);
    expect(guardada?.estado).toBe("stale");
    expect(guardada?.metadata["revisar"]).toBe(true);
    expect(guardada?.detalle).toContain("Conviene revisar");
  });

  it("un documento sin trozos no se da por bueno", async () => {
    const db = new DbFalsa();
    const r = await verificarFuente(
      { db, embeddings: new EmbeddingsFalsos() },
      { workspaceId: "ws", cerebroId: "cerebro-1", fuenteId: "f", documento, trozos: [] },
    );
    expect(r.aprobado).toBe(false);
    expect(r.aviso).toBeDefined();
  });
});
