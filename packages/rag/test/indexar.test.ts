import { describe, expect, it } from "vitest";
import { indexarDocumento, planificar, prepararDocumento } from "../src/indexar.js";
import { ingerirTexto } from "../src/ingest/archivos.js";
import { DbFalsa, EmbeddingsFalsos } from "./dobles.js";
import type { DocumentoCrudo } from "../src/types.js";

function catalogo(precioPro = "90.000"): DocumentoCrudo {
  return ingerirTexto({
    titulo: "Catálogo",
    uri: "catalogo.md",
    texto: [
      "# Catálogo",
      "",
      "Vendemos sillas y escritorios para oficina en casa con entrega en toda la ciudad.",
      "",
      "## Precios",
      "",
      "| Plan | Precio |",
      "| --- | --- |",
      `| Pro | ${precioPro} |`,
      "| Básico | 40.000 |",
      "",
      "## Envíos",
      "",
      "Enviamos en veinticuatro horas dentro del área metropolitana y en tres días al resto del país.",
    ].join("\n"),
  });
}

describe("reindexado incremental", () => {
  it("la misma entrada dos veces cuesta cero llamadas de embedding", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    const deps = { db, embeddings };
    const documento = catalogo();

    const primera = await indexarDocumento(deps, { workspaceId: "ws", cerebroId: "cerebro-1", documento });
    expect(primera.textosIncrustados).toBeGreaterThan(0);
    expect(primera.estado).toBe("indexed");
    const gastoInicial = embeddings.textosIncrustados;

    const segunda = await indexarDocumento(deps, { workspaceId: "ws", cerebroId: "cerebro-1", documento });
    expect(segunda.sinCambios).toBe(true);
    expect(segunda.textosIncrustados).toBe(0);
    expect(embeddings.textosIncrustados).toBe(gastoInicial);
    expect(embeddings.llamadas).toBeGreaterThan(0);
    // Y no se ha tocado ni un trozo.
    expect(db.trozos.size).toBe(primera.trozosTotales);
  });

  it("un cambio pequeño solo vuelve a incrustar los trozos afectados", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    const deps = { db, embeddings };

    const largo = Array.from({ length: 8 }, (_, i) =>
      `## Sección ${i}\n\nTexto de la sección ${i}. ${"Palabras de relleno suficientes para llenar el trozo. ".repeat(30)}`,
    ).join("\n\n");

    const v1 = ingerirTexto({ titulo: "Manual", uri: "manual.md", texto: `# Manual\n\n${largo}` });
    const r1 = await indexarDocumento(deps, { workspaceId: "ws", cerebroId: "cerebro-1", documento: v1 });
    expect(r1.trozosTotales).toBeGreaterThan(3);
    const gasto1 = embeddings.textosIncrustados;

    const v2 = ingerirTexto({
      titulo: "Manual",
      uri: "manual.md",
      texto: `# Manual\n\n${largo.replace("Texto de la sección 7.", "Texto de la sección 7 corregido.")}`,
    });
    const r2 = await indexarDocumento(deps, { workspaceId: "ws", cerebroId: "cerebro-1", documento: v2 });

    expect(r2.sinCambios).toBe(false);
    expect(r2.trozosNuevos).toBeGreaterThan(0);
    expect(r2.trozosNuevos).toBeLessThan(r1.trozosTotales);
    expect(r2.trozosReutilizados).toBeGreaterThan(0);
    // El gasto de la segunda pasada es solo el de los trozos tocados.
    expect(embeddings.textosIncrustados - gasto1).toBe(r2.trozosNuevos);
  });

  it("`forzar` reindexa aunque el contenido sea idéntico", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    const deps = { db, embeddings };
    const documento = catalogo();
    await indexarDocumento(deps, { workspaceId: "ws", cerebroId: "cerebro-1", documento });
    const gasto = embeddings.textosIncrustados;
    const r = await indexarDocumento(deps, {
      workspaceId: "ws",
      cerebroId: "cerebro-1",
      documento,
      opciones: { forzar: true },
    });
    expect(r.textosIncrustados).toBeGreaterThan(0);
    expect(embeddings.textosIncrustados).toBeGreaterThan(gasto);
  });

  it("un documento escaneado se marca «conviene revisar» sin gastar nada", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    const r = await indexarDocumento(
      { db, embeddings },
      {
        workspaceId: "ws",
        cerebroId: "cerebro-1",
        documento: { tipo: "file", titulo: "Catálogo escaneado", uri: "escaneo.pdf", markdown: "", necesitaOcr: true },
      },
    );
    expect(r.estado).toBe("stale");
    expect(r.necesitaOcr).toBe(true);
    expect(embeddings.textosIncrustados).toBe(0);
    const fuente = db.fuentes.get(r.fuenteId);
    expect(fuente?.metadata["revisar"]).toBe(true);
    expect(fuente?.metadata["motivo"]).toBe("necesita_ocr");
  });

  it("una fuente que falla queda en error y no se pierde el motivo", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    embeddings.incrustar = async (): Promise<never> => {
      throw new Error("el proveedor está caído");
    };
    await expect(
      indexarDocumento({ db, embeddings }, { workspaceId: "ws", cerebroId: "cerebro-1", documento: catalogo() }),
    ).rejects.toThrow("el proveedor está caído");
    const fuente = [...db.fuentes.values()][0];
    expect(fuente?.estado).toBe("error");
    expect(fuente?.detalle).toContain("caído");
  });
});

describe("plan de escritura", () => {
  it("reutiliza el vector de un trozo que solo cambió de posición", () => {
    const { trozos } = prepararDocumento(catalogo());
    const existentes = trozos.map((t, i) => ({ id: `t${i}`, posicion: i, hash: t.hash }));
    // Se simula que los trozos llegan en otro orden: mismo texto, otra posición.
    const reordenados = [...trozos].reverse().map((t, i) => ({ ...t, posicion: i }));
    const plan = planificar({ fuenteId: "f", trozosNuevos: reordenados, trozosExistentes: existentes });
    expect(plan.aIncrustar).toHaveLength(0);
    expect(plan.eliminar).toHaveLength(0);
    expect(plan.conservar).toHaveLength(trozos.length);
  });

  it("elimina los trozos que ya no existen en el documento nuevo", () => {
    const { trozos } = prepararDocumento(catalogo());
    const existentes = [
      ...trozos.map((t, i) => ({ id: `t${i}`, posicion: i, hash: t.hash })),
      { id: "sobrante", posicion: 99, hash: "hash-que-ya-no-esta" },
    ];
    const plan = planificar({ fuenteId: "f", trozosNuevos: trozos, trozosExistentes: existentes });
    expect(plan.eliminar).toEqual(["sobrante"]);
  });
});
