/**
 * La publicación.
 *
 * Se prueba con un ejecutor de mentira que apunta cada sentencia. No es una
 * prueba de SQL: es una prueba de la REGLA que el SQL tiene que respetar, y la
 * regla es que `agent_versions` no se actualiza nunca. Publicar dos veces
 * inserta dos filas; revertir sería publicar una tercera.
 *
 * Que la prueba mire el texto de las sentencias parece frágil hasta que se
 * recuerda qué se está protegiendo: el día que alguien "optimice" la
 * publicación con un UPDATE, el historial de qué prompt respondió a un cliente
 * deja de existir en silencio, y este test es lo único que se entera.
 */
import { describe, expect, it } from "vitest";
import { leerEspecificacion } from "@strappy/db/spec";
import { computePromptHash } from "@strappy/core";
import { aPromptSpec } from "@strappy/db/spec";
import {
  PublicacionInvalidaError,
  publicarDesdeBorrador,
  type EjecutorSql,
} from "./publicar";

const WS = "11111111-1111-1111-1111-111111111111";

function ejecutorFalso(): EjecutorSql & { sentencias: { sql: string; valores: unknown[] }[] } {
  const sentencias: { sql: string; valores: unknown[] }[] = [];
  let versiones = 0;

  return {
    workspaceId: WS,
    sentencias,
    async query<T>(sql: string, valores: readonly unknown[] = []): Promise<{ rows: T[] }> {
      sentencias.push({ sql, valores: [...valores] });
      if (/insert into public\.agents\b/.test(sql)) {
        return { rows: [{ id: "agente-1" }] as unknown as T[] };
      }
      if (/insert into public\.agent_versions\b/.test(sql)) {
        versiones += 1;
        return { rows: [{ id: `version-${versiones}`, version: versiones }] as unknown as T[] };
      }
      return { rows: [] };
    },
  };
}

const SPEC = leerEspecificacion({
  identidad: {
    nombre: "Espiga",
    idioma: "español",
    tono: "cercano y breve, tutea",
    proposito: "atender pedidos",
  },
  hace: ["Responde precios del catálogo"],
  noHace: ["No promete descuentos"],
  recoger: [{ clave: "telefono", etiqueta: "teléfono", obligatorio: true }],
  escalar: [],
});

describe("publicar un agente", () => {
  it("crea el agente, su versión y mueve el puntero", async () => {
    const db = ejecutorFalso();
    const resultado = await publicarDesdeBorrador(db, { spec: SPEC, modo: "lite" });

    expect(resultado.agenteId).toBe("agente-1");
    expect(resultado.version).toBe(1);
    expect(resultado.nombre).toBe("Espiga");

    const sqls = db.sentencias.map((s) => s.sql);
    expect(sqls.some((s) => /insert into public\.agents\b/.test(s))).toBe(true);
    expect(sqls.some((s) => /insert into public\.agent_versions\b/.test(s))).toBe(true);
    expect(
      sqls.some((s) => /update public\.agents/.test(s) && /active_version_id/.test(s)),
    ).toBe(true);
  });

  it("la versión es inmutable: nunca se actualiza ni se borra", async () => {
    const db = ejecutorFalso();
    await publicarDesdeBorrador(db, { spec: SPEC, modo: "lite" });
    await publicarDesdeBorrador(db, { spec: SPEC, modo: "lite", agenteId: "agente-1" });

    for (const { sql } of db.sentencias) {
      expect(sql).not.toMatch(/update\s+public\.agent_versions/i);
      expect(sql).not.toMatch(/delete\s+from\s+public\.agent_versions/i);
    }

    const inserciones = db.sentencias.filter((s) =>
      /insert into public\.agent_versions\b/.test(s.sql),
    );
    expect(inserciones).toHaveLength(2);
    // El número de versión se calcula en SQL sobre el máximo existente: si se
    // calculara en TypeScript, dos publicaciones simultáneas chocarían.
    expect(inserciones[0]?.sql).toMatch(/max\(version\)/);
  });

  it("publicar sobre un agente existente no crea otro agente", async () => {
    const db = ejecutorFalso();
    await publicarDesdeBorrador(db, { spec: SPEC, modo: "max", agenteId: "agente-7" });

    expect(db.sentencias.some((s) => /insert into public\.agents\b/.test(s.sql))).toBe(false);
    const version = db.sentencias.find((s) =>
      /insert into public\.agent_versions\b/.test(s.sql),
    );
    expect(version?.valores).toContain("agente-7");
  });

  it("guarda el hash del MISMO compilador que ejecuta el motor", async () => {
    const db = ejecutorFalso();
    const resultado = await publicarDesdeBorrador(db, { spec: SPEC, modo: "lite" });

    expect(resultado.huellaPrompt).toBe(computePromptHash(aPromptSpec(SPEC)));

    const version = db.sentencias.find((s) =>
      /insert into public\.agent_versions\b/.test(s.sql),
    );
    expect(version?.valores).toContain(resultado.huellaPrompt);
  });

  it("no borra el hilo de Strap al publicar", async () => {
    const db = ejecutorFalso();
    await publicarDesdeBorrador(db, { spec: SPEC, modo: "lite" });
    const borrado = db.sentencias.find((s) => /delete from public\.agent_drafts/.test(s.sql));
    // Sin este `thread_id is null`, publicar borra la conversación desde la
    // que se publicó, justo en el momento de celebrarla.
    expect(borrado?.sql).toMatch(/thread_id is null/);
  });

  it("declara las variables del agente", async () => {
    const db = ejecutorFalso();
    await publicarDesdeBorrador(db, {
      spec: SPEC,
      modo: "lite",
      variables: [
        { clave: "telefono", etiqueta: "teléfono", tipo: "text", obligatoria: true },
      ],
    });
    const variable = db.sentencias.find((s) =>
      /insert into public\.agent_variables/.test(s.sql),
    );
    expect(variable?.valores).toContain("telefono");
  });

  it("se niega a publicar un agente sin nombre o sin nada que hacer", async () => {
    const db = ejecutorFalso();
    await expect(
      publicarDesdeBorrador(db, {
        spec: leerEspecificacion({ identidad: { nombre: "  " }, hace: ["algo"] }),
        modo: "lite",
      }),
    ).rejects.toBeInstanceOf(PublicacionInvalidaError);

    await expect(
      publicarDesdeBorrador(db, {
        spec: leerEspecificacion({ identidad: { nombre: "Espiga" }, hace: [] }),
        modo: "lite",
      }),
    ).rejects.toBeInstanceOf(PublicacionInvalidaError);

    // Nada se escribió: la validación va antes de la primera sentencia.
    expect(db.sentencias).toHaveLength(0);
  });
});
