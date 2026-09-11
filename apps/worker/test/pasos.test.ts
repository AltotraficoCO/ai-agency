/**
 * El registro de trabajo del worker: fusiona, agrupa escrituras, cierra lo que
 * quedó en curso y nunca deja que un fallo al guardar tumbe la tarea.
 */
import { describe, expect, it } from "vitest";
import type { PasoTrabajo } from "@strappy/webmaster";
import { RegistroDePasos } from "../src/consumers/pasos.js";

const paso = (p: Partial<PasoTrabajo> & { id: string }): PasoTrabajo => ({
  herramienta: "wp_leer_contenido",
  etiqueta: "Leyendo una página",
  estado: "en_curso",
  detalle: null,
  en: "2026-09-11T10:00:00.000Z",
  ...p,
});

describe("registro de pasos del worker", () => {
  it("agrupa los avisos seguidos en pocas escrituras y guarda el estado final", async () => {
    const escrituras: (readonly PasoTrabajo[])[] = [];
    const registro = new RegistroDePasos({
      guardar: async (pasos) => {
        escrituras.push(pasos);
      },
      intervaloMs: 50,
    });
    registro.anotar(paso({ id: "a" }));
    registro.anotar(paso({ id: "a", estado: "hecho" }));
    registro.anotar(paso({ id: "b" }));
    await registro.cerrar("completada");

    expect(escrituras.length).toBeLessThanOrEqual(2);
    expect(escrituras.at(-1)?.map((p) => [p.id, p.estado])).toEqual([
      ["a", "hecho"],
      ["b", "hecho"],
    ]);
  });

  it("al fallar la tarea, lo que quedó en curso pasa a error", async () => {
    let ultimo: readonly PasoTrabajo[] = [];
    const registro = new RegistroDePasos({
      guardar: async (pasos) => {
        ultimo = pasos;
      },
      intervaloMs: 0,
    });
    registro.anotar(paso({ id: "a" }));
    await registro.cerrar("fallida");
    expect(ultimo.map((p) => p.estado)).toEqual(["error"]);
  });

  it("conserva los pasos de un intento anterior y descarta basura", async () => {
    let ultimo: readonly PasoTrabajo[] = [];
    const registro = new RegistroDePasos({
      previos: [paso({ id: "viejo", estado: "hecho" }), { basura: true }],
      guardar: async (pasos) => {
        ultimo = pasos;
      },
      intervaloMs: 0,
    });
    registro.anotar(paso({ id: "nuevo" }));
    await registro.cerrar("esperando_aprobacion");
    expect(ultimo.map((p) => p.id)).toEqual(["viejo", "nuevo"]);
  });

  it("un fallo al guardar se registra y no se propaga", async () => {
    const logs: string[] = [];
    const registro = new RegistroDePasos({
      guardar: async () => {
        throw new Error("sin conexión");
      },
      log: (m) => logs.push(m),
      intervaloMs: 0,
    });
    registro.anotar(paso({ id: "a" }));
    await expect(registro.cerrar("completada")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("sin conexión"))).toBe(true);
  });
});
