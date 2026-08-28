import { describe, expect, it, vi } from "vitest";
import { aplicarUmbral, componerConsulta, consultaLexica, recuperar, TIMEOUT_MS } from "../src/recuperar.js";
import { Cerebro } from "../src/cerebro.js";
import { DbFalsa, EmbeddingsFalsos, filaBusqueda } from "./dobles.js";
import { AJUSTES_POR_DEFECTO, type FilaBusqueda } from "../src/types.js";

describe("composición de la consulta con dos turnos", () => {
  it("arrastra el turno anterior para resolver «¿y eso cuánto vale?»", () => {
    const consulta = componerConsulta([
      "hola buenas",
      "¿tienen la silla ergonómica azul?",
      "¿y eso cuánto vale?",
    ]);
    expect(consulta).toContain("cuánto vale");
    expect(consulta).toContain("silla ergonómica azul");
    // El turno más reciente va primero: es el que debe pesar en el vector.
    expect(consulta.indexOf("cuánto vale")).toBeLessThan(consulta.indexOf("silla"));
  });

  it("no duplica el texto cuando los dos turnos son iguales", () => {
    expect(componerConsulta(["¿cuánto cuesta?", "¿cuánto cuesta?"])).toBe("¿cuánto cuesta?");
  });

  it("ignora turnos vacíos y devuelve cadena vacía si no queda nada", () => {
    expect(componerConsulta(["   ", ""])).toBe("");
    expect(componerConsulta([])).toBe("");
  });

  it("recorta por el final, que es el turno más antiguo", () => {
    const largo = "a".repeat(500);
    const consulta = componerConsulta([largo, "¿cuánto cuesta el plan pro?"]);
    expect(consulta.startsWith("¿cuánto cuesta el plan pro?")).toBe(true);
    expect(consulta.length).toBeLessThanOrEqual(400);
  });

  it("la parte léxica se reescribe con `or`: con AND no encontraría nada", () => {
    const lexica = consultaLexica("¿Cuánto cuesta el Plan Pro?");
    expect(lexica).toBe("cuánto or cuesta or plan or pro");
    // Un guion inicial es NOT en websearch_to_tsquery: jamás debe colarse.
    expect(consultaLexica("silla -azul")).toBe("silla or azul");
    expect(consultaLexica("ref X-240")).toContain("x-240");
  });

  it("la búsqueda real llega al puerto con los dos turnos dentro", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    let consultaVista = "";
    db.respuestaBusqueda = async ({ consulta }): Promise<readonly FilaBusqueda[]> => {
      consultaVista = consulta;
      return [];
    };
    await recuperar(
      { db, embeddings },
      {
        workspaceId: "ws",
        cerebroIds: ["cerebro-1"],
        turnosUsuario: ["¿tienen sillas ergonómicas?", "¿y eso cuánto vale?"],
      },
    );
    expect(consultaVista).toContain("ergonómicas");
    expect(consultaVista).toContain("vale");
    expect(consultaVista).toContain(" or ");
  });
});

describe("degradación por tiempo", () => {
  it("a los 800 ms devuelve vacío en vez de colgar el turno", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    db.respuestaBusqueda = (): Promise<readonly FilaBusqueda[]> =>
      new Promise((resolve) => {
        setTimeout(() => resolve([filaBusqueda({ chunkId: "c1" })]), 5_000);
      });

    const avisos: string[] = [];
    const inicio = Date.now();
    const r = await recuperar(
      { db, embeddings, registro: { aviso: (e): void => void avisos.push(e) } },
      { workspaceId: "ws", cerebroIds: ["cerebro-1"], turnosUsuario: ["¿cuánto cuesta?"] },
    );
    const transcurrido = Date.now() - inicio;

    expect(r.degradado).toBe(true);
    expect(r.fragmentos).toEqual([]);
    expect(transcurrido).toBeLessThan(TIMEOUT_MS + 400);
    expect(avisos).toContain("conocimiento.degradado");
  });

  it("un fallo del proveedor de embeddings tampoco lanza: degrada", async () => {
    const db = new DbFalsa();
    const embeddings = new EmbeddingsFalsos();
    embeddings.incrustar = async (): Promise<never> => {
      throw new Error("gateway 503");
    };
    const r = await recuperar(
      { db, embeddings },
      { workspaceId: "ws", cerebroIds: ["cerebro-1"], turnosUsuario: ["hola"] },
    );
    expect(r.degradado).toBe(true);
    expect(r.fragmentos).toEqual([]);
  });

  it("`search` del KnowledgePort nunca lanza aunque todo falle", async () => {
    const db = new DbFalsa();
    db.respuestaBusqueda = async (): Promise<never> => {
      throw new Error("la base de datos está caída");
    };
    const cerebro = new Cerebro({ db, embeddings: new EmbeddingsFalsos() });
    const fragmentos = await cerebro.search({
      workspaceId: "ws",
      agentId: "agente-1",
      query: "¿cuánto cuesta?",
      limit: 4,
    });
    expect(fragmentos).toEqual([]);
  });

  it("dentro del plazo devuelve los fragmentos con su fuente citada", async () => {
    const db = new DbFalsa();
    await db.registrarFuente({ cerebroId: "cerebro-1", titulo: "Catálogo 2026", uri: "https://tienda.co/catalogo" });
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "c1", sourceId: "fuente-1", contenido: "Precios > Plan Pro\n\nCuesta 90.000", puntuacion: 0.032 }),
    ];
    const cerebro = new Cerebro({ db, embeddings: new EmbeddingsFalsos() });
    const fragmentos = await cerebro.search({
      workspaceId: "ws",
      cerebroIds: ["cerebro-1"],
      query: "¿cuánto cuesta el plan pro?",
      limit: 4,
    });
    expect(fragmentos).toHaveLength(1);
    expect(fragmentos[0]?.title).toBe("Catálogo 2026");
    expect(fragmentos[0]?.source).toBe("https://tienda.co/catalogo");
  });
});

describe("umbral de exigencia", () => {
  const filas: readonly FilaBusqueda[] = [
    filaBusqueda({ chunkId: "a", puntuacion: 0.032, distancia: 0.18 }),
    filaBusqueda({ chunkId: "b", puntuacion: 0.016, distancia: 0.55 }),
    filaBusqueda({ chunkId: "c", puntuacion: 0.002, distancia: 0.9 }),
  ];

  it("estricto descarta lo que se parece poco", () => {
    const r = aplicarUmbral(filas, { amplitud: "normal", exigencia: "estricto" }, 5);
    expect(r.filter((x) => x.usado).map((x) => x.chunkId)).toEqual(["a"]);
    expect(r[2]?.motivo).toContain("por debajo");
  });

  it("amplio deja pasar más", () => {
    const r = aplicarUmbral(filas, { amplitud: "normal", exigencia: "amplio" }, 5);
    expect(r.filter((x) => x.usado)).toHaveLength(2);
  });

  it("no descarta un acierto puramente literal por no tener distancia", () => {
    const soloLexico = [
      filaBusqueda({ chunkId: "ref", puntuacion: 0.016, distancia: null, rangoVectorial: null, rangoLexico: 1 }),
    ];
    const r = aplicarUmbral(soloLexico, { amplitud: "normal", exigencia: "estricto" }, 5);
    expect(r[0]?.usado).toBe(true);
    expect(r[0]?.motivo).toContain("palabras exactas");
  });

  it("respeta el número de fragmentos pedido", () => {
    const r = aplicarUmbral(filas, AJUSTES_POR_DEFECTO, 1);
    expect(r.filter((x) => x.usado)).toHaveLength(1);
    expect(r[1]?.motivo).toContain("fuera del número");
  });
});

describe("explicarBusqueda", () => {
  it("explica qué se usó, con qué puntuación y por qué se descartó lo demás", async () => {
    const db = new DbFalsa();
    await db.registrarFuente({ cerebroId: "cerebro-1", titulo: "Política de envíos", uri: "https://tienda.co/envios" });
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "a", sourceId: "fuente-1", contenido: "Envíos > Cobertura\n\nEnviamos a todo el país.", puntuacion: 0.032, distancia: 0.15 }),
      filaBusqueda({ chunkId: "b", sourceId: "fuente-1", contenido: "Otra cosa", puntuacion: 0.001, distancia: 0.95 }),
    ];
    const cerebro = new Cerebro({ db, embeddings: new EmbeddingsFalsos() });
    const explicacion = await cerebro.explicarBusqueda("¿hacen envíos a Cali?", {
      workspaceId: "ws",
      cerebroIds: ["cerebro-1"],
      turnoAnterior: "buenas tardes",
    });
    expect(explicacion.candidatos).toHaveLength(2);
    expect(explicacion.candidatos[0]?.usado).toBe(true);
    expect(explicacion.candidatos[0]?.documento).toBe("Política de envíos");
    expect(explicacion.candidatos[1]?.usado).toBe(false);
    expect(explicacion.consultaUsada).toContain("envíos a Cali");
    expect(explicacion.degradado).toBe(false);
  });
});

describe("turnos leídos por el puerto", () => {
  it("pide los dos últimos turnos cuando solo se le da la conversación", async () => {
    const db = new DbFalsa();
    let consultaVista = "";
    db.respuestaBusqueda = async ({ consulta }): Promise<readonly FilaBusqueda[]> => {
      consultaVista = consulta;
      return [];
    };
    const ultimosTurnosUsuario = vi.fn(async () => ["¿tienen sillas azules?", "¿y eso cuánto vale?"]);
    const cerebro = new Cerebro({
      db,
      embeddings: new EmbeddingsFalsos(),
      turnos: { ultimosTurnosUsuario },
    });
    await cerebro.search({
      workspaceId: "ws",
      cerebroIds: ["cerebro-1"],
      conversationId: "conv-1",
      query: "¿y eso cuánto vale?",
      limit: 4,
    });
    expect(ultimosTurnosUsuario).toHaveBeenCalledWith({ workspaceId: "ws", conversationId: "conv-1", cuantos: 2 });
    expect(consultaVista).toContain("azules");
  });
});
