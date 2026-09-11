/**
 * Modo solo texto: el conocimiento funciona sin proveedor de embeddings.
 *
 * Lo que aquí se protege no es una función, es una decisión de producto: una
 * instalación sin proveedor de embeddings (desarrollo, un despliegue a medio
 * configurar) sigue teniendo Cerebros que funcionan. Si alguno de estos tests
 * empieza a estorbar, lo que hay que revisar es el código, no el test.
 */
import { describe, expect, it } from "vitest";
import { Cerebro } from "../src/cerebro.js";
import { indexarDocumento } from "../src/indexar.js";
import { ingerirTexto } from "../src/ingest/archivos.js";
import {
  detectarModoConocimiento,
  explicacionDelModo,
  hayProveedorDeEmbeddings,
} from "../src/modo.js";
import { aplicarUmbral, recuperar } from "../src/recuperar.js";
import { revectorizarPendientes } from "../src/revectorizar.js";
import { AJUSTES_POR_DEFECTO, type DocumentoCrudo, type FilaBusqueda } from "../src/types.js";
import { DbFalsa, EmbeddingsFalsos, filaBusqueda } from "./dobles.js";

function catalogo(): DocumentoCrudo {
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
      "La referencia X-240 cuesta 90.000 pesos e incluye envío al área metropolitana.",
      "",
      "## Envíos",
      "",
      "Enviamos en veinticuatro horas dentro del área metropolitana y en tres días al resto del país.",
    ].join("\n"),
  });
}

describe("detección del proveedor de embeddings", () => {
  it("sin clave el modo es solo texto, y se dice a propósito", () => {
    const diagnostico = detectarModoConocimiento({});
    expect(hayProveedorDeEmbeddings({})).toBe(false);
    expect(diagnostico.modo).toBe("solo-texto");
    expect(diagnostico.variable).toBeNull();
    expect(diagnostico.motivo).toContain("OPENAI_API_KEY");
  });

  it("basta poner OPENAI_API_KEY para que el modo completo se active solo", () => {
    const diagnostico = detectarModoConocimiento({ OPENAI_API_KEY: "sk-lo-que-sea" });
    expect(diagnostico.modo).toBe("completo");
    expect(diagnostico.variable).toBe("OPENAI_API_KEY");
  });

  it("AI_GATEWAY_API_KEY también sirve; una cadena vacía no", () => {
    expect(detectarModoConocimiento({ AI_GATEWAY_API_KEY: "abc" }).modo).toBe("completo");
    expect(detectarModoConocimiento({ OPENAI_API_KEY: "   " }).modo).toBe("solo-texto");
  });
});

describe("ingesta en modo solo texto", () => {
  it("no gasta ni una llamada de embedding y deja el contenido buscable", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();

    const resultado = await indexarDocumento({ db }, {
      workspaceId: "ws",
      cerebroId: "cerebro-1",
      documento: catalogo(),
    });

    expect(embeddings.llamadas).toBe(0);
    expect(resultado.modo).toBe("solo-texto");
    expect(resultado.estado).toBe("indexed");
    expect(resultado.textosIncrustados).toBe(0);
    expect(resultado.trozosNuevos).toBeGreaterThan(0);

    const trozos = [...db.trozos.values()];
    expect(trozos.length).toBe(resultado.trozosNuevos);
    // `embedding = NULL`: la rama vectorial del SQL los ignora y la léxica no.
    expect(trozos.every((t) => t.embedding === null)).toBe(true);
    expect(trozos.every((t) => t.metadata["sinVectorizar"] === true)).toBe(true);
    // La fuente queda indexada, no en error ni pendiente.
    expect([...db.fuentes.values()][0]?.estado).toBe("indexed");
    expect([...db.fuentes.values()][0]?.metadata["modo"]).toBe("solo-texto");
  });

  it("con proveedor sí vectoriza: el modo no se queda pegado", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    const resultado = await indexarDocumento(
      { db, embeddings },
      { workspaceId: "ws", cerebroId: "cerebro-1", documento: catalogo() },
    );
    expect(resultado.modo).toBe("completo");
    expect(resultado.textosIncrustados).toBeGreaterThan(0);
    expect([...db.trozos.values()].every((t) => t.embedding !== null)).toBe(true);
  });
});

describe("recuperación en modo solo texto", () => {
  it("pasa null como vector a search_knowledge y no llama al proveedor", async () => {
    const db = new DbFalsa();
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "t1", rangoVectorial: null, rangoLexico: 1, distancia: null }),
    ];

    const r = await recuperar(
      { db },
      { workspaceId: "ws", cerebroIds: ["cerebro-1"], turnosUsuario: ["¿cuánto cuesta la X-240?"] },
    );

    expect(db.vectoresRecibidos).toEqual([null]);
    expect(r.modo).toBe("solo-texto");
    expect(r.degradado).toBe(false);
    expect(r.fragmentos.length).toBe(1);
  });

  it("un resultado puramente léxico NO se descarta por no tener distancia", () => {
    const soloLexico = filaBusqueda({
      chunkId: "t1",
      rangoVectorial: null,
      rangoLexico: 1,
      distancia: null,
      puntuacion: 0.0164,
    });
    const candidatos = aplicarUmbral(
      [soloLexico],
      { amplitud: "normal", exigencia: "estricto" },
      5,
      "solo-texto",
    );
    expect(candidatos[0]?.usado).toBe(true);
    expect(candidatos[0]?.motivo).toBe("coincide por palabras exactas");
  });

  it("en modo solo texto el umbral de distancia no se aplica nunca", () => {
    // Distancia altísima heredada de una indexación anterior: en este modo no
    // significa nada y no puede servir para descartar.
    const fila = filaBusqueda({ chunkId: "t1", rangoLexico: 1, distancia: 0.99, puntuacion: 0.0164 });
    expect(aplicarUmbral([fila], { amplitud: "normal", exigencia: "estricto" }, 5, "solo-texto")[0]?.usado).toBe(true);
    expect(aplicarUmbral([fila], { amplitud: "normal", exigencia: "estricto" }, 5, "completo")[0]?.usado).toBe(false);
  });

  it("el corte que sí manda es la posición: nada más allá del límite pedido", () => {
    const filas = [1, 2, 3, 4].map((i) =>
      filaBusqueda({ chunkId: `t${i}`, rangoVectorial: null, rangoLexico: i, distancia: null, puntuacion: 1 / (60 + i) }),
    );
    const candidatos = aplicarUmbral(filas, AJUSTES_POR_DEFECTO, 2, "solo-texto");
    expect(candidatos.filter((c) => c.usado).map((c) => c.chunkId)).toEqual(["t1", "t2"]);
    expect(candidatos[2]?.motivo).toBe("cabe fuera del número de fragmentos pedido");
  });
});

describe("reindexado posterior sin reingerir", () => {
  it("solo toca los trozos sin vector y no vuelve a trocear nada", async () => {
    const db = new DbFalsa();
    // Día 1: sin proveedor.
    // Troceado fino a propósito: hacen falta varios trozos para distinguir
    // «vectorizó los pendientes» de «vectorizó todo otra vez».
    await indexarDocumento(
      { db },
      {
        workspaceId: "ws",
        cerebroId: "cerebro-1",
        documento: catalogo(),
        opciones: { troceado: { objetivoMinimo: 20, objetivoMaximo: 40, maximoAbsoluto: 80 } },
      },
    );
    expect(db.trozos.size).toBeGreaterThan(2);
    const idsIniciales = [...db.trozos.keys()].sort();
    const hashesIniciales = [...db.trozos.values()].map((t) => t.hash).sort();

    // Un trozo que ya venía vectorizado de antes: no debe volver a pagarse.
    const yaVectorizado = [...db.trozos.values()][0];
    if (!yaVectorizado) throw new Error("hacen falta trozos");
    yaVectorizado.embedding = [1, 2, 3];
    const pendientes = [...db.trozos.values()].filter((t) => t.embedding === null).length;
    expect(pendientes).toBeGreaterThan(0);

    // Día 2: aparece la clave.
    const embeddings = new EmbeddingsFalsos();
    const resultado = await revectorizarPendientes({ db, embeddings }, { workspaceId: "ws" });

    expect(resultado.trozosVectorizados).toBe(pendientes);
    expect(embeddings.textosIncrustados).toBe(pendientes);
    expect([...db.trozos.values()].every((t) => t.embedding !== null)).toBe(true);
    // Ni un trozo nuevo, ni un hash distinto: no se reingirió nada.
    expect([...db.trozos.keys()].sort()).toEqual(idsIniciales);
    expect([...db.trozos.values()].map((t) => t.hash).sort()).toEqual(hashesIniciales);
    expect(db.modelosDeRevectorizado).toEqual(["modelo-de-prueba"]);

    // Y una segunda pasada no encuentra nada que hacer.
    const segunda = await revectorizarPendientes({ db, embeddings }, { workspaceId: "ws" });
    expect(segunda.trozosVectorizados).toBe(0);
    expect(embeddings.textosIncrustados).toBe(pendientes);
  });
});

describe("lo que ve el cliente en «Pruébalo»", () => {
  const JERGA = ["embedding", "vector", "coseno", "semántic", "token", "índice", "rag"];

  it("explica en español llano que busca por palabras, sin una palabra de jerga", async () => {
    const db = new DbFalsa();
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "t1", rangoVectorial: null, rangoLexico: 1, distancia: null }),
    ];
    const cerebro = new Cerebro({ db });

    expect(cerebro.modo).toBe("solo-texto");
    const explicacion = await cerebro.explicarBusqueda("¿cuánto cuesta la X-240?", {
      workspaceId: "ws",
      cerebroIds: ["cerebro-1"],
    });

    expect(explicacion.modo).toBe("solo-texto");
    const texto = explicacion.explicacion.toLowerCase();
    expect(texto).toContain("coincidencia de palabras");
    expect(texto).toContain("no por significado");
    // Qué implica: acierta con lo literal, falla si se pregunta de otra manera.
    expect(texto).toContain("precios");
    expect(texto).toContain("otra manera");
    for (const palabra of JERGA) expect(texto).not.toContain(palabra);
  });

  it("el mensaje del modo completo tampoco usa jerga", () => {
    const texto = explicacionDelModo("completo").toLowerCase();
    expect(texto).toContain("significado");
    for (const palabra of JERGA) expect(texto).not.toContain(palabra);
  });
});
