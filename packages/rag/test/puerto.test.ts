import { describe, expect, it } from "vitest";
import { Cerebro } from "../src/cerebro.js";
import { DbFalsa, EmbeddingsFalsos, filaBusqueda } from "./dobles.js";
import type { FilaBusqueda } from "../src/types.js";

/**
 * Copia literal de la interfaz que declaran `@strappy/core` y `@strappy/tools`.
 * Se replica en vez de importarla para no acoplar el typecheck de este paquete
 * a dos que otra corriente está editando; si allí cambia la forma, este test es
 * lo que hay que actualizar y lo que avisa de que el motor dejó de encajar.
 */
interface KnowledgePortDelMotor {
  search(input: {
    workspaceId: string;
    agentId: string;
    query: string;
    limit: number;
  }): Promise<readonly { title: string; text: string; source?: string }[]>;
}

describe("encaje con el motor", () => {
  it("Cerebro cumple el KnowledgePort que espera el motor", async () => {
    const db = new DbFalsa();
    await db.registrarFuente({ cerebroId: "cerebro-1", titulo: "Horarios", uri: "https://tienda.co/horarios" });
    db.respuestaBusqueda = async (): Promise<readonly FilaBusqueda[]> => [
      filaBusqueda({ chunkId: "c1", sourceId: "fuente-1", contenido: "Abrimos de 8 a 6.", puntuacion: 0.03 }),
    ];

    // Si esta asignación deja de compilar, el motor ya no puede montar el RAG.
    const puerto: KnowledgePortDelMotor = new Cerebro({ db, embeddings: new EmbeddingsFalsos() });

    const hits = await puerto.search({
      workspaceId: "ws",
      agentId: "agente-1",
      query: "¿a qué hora abren?",
      limit: 3,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Horarios");
    expect(hits[0]?.text).toContain("Abrimos");
  });

  it("sin cerebros conectados devuelve vacío sin llamar al proveedor", async () => {
    const db = new DbFalsa();
    db.cerebrosDeAgente = async () => [];
    const embeddings = new EmbeddingsFalsos();
    const hits = await new Cerebro({ db, embeddings }).search({
      workspaceId: "ws",
      agentId: "agente-sin-cerebro",
      query: "hola",
      limit: 3,
    });
    expect(hits).toEqual([]);
    expect(embeddings.llamadas).toBe(0);
  });
});
