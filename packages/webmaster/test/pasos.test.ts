/**
 * El registro de trabajo contado para personas: etiquetas, detalle seguro,
 * fusión por id y reconstrucción desde una conversación guardada.
 */
import { describe, expect, it } from "vitest";
import {
  detalleDePaso,
  esPasoTrabajo,
  etiquetaDePaso,
  fusionarPasos,
  pasosDesdeMensajes,
  type PasoTrabajo,
} from "../src/pasos.js";

const paso = (p: Partial<PasoTrabajo> & { id: string }): PasoTrabajo => ({
  herramienta: "wp_leer_contenido",
  etiqueta: "Leyendo una página",
  estado: "en_curso",
  detalle: null,
  en: "2026-09-11T10:00:00.000Z",
  ...p,
});

describe("etiquetas y detalle", () => {
  it("cuenta en gerundio y con un respaldo para herramientas nuevas", () => {
    expect(etiquetaDePaso("wp_instalar_plugin")).toBe("Instalando un plugin");
    expect(etiquetaDePaso("herramienta_que_no_existe")).toBe("Trabajando en tu sitio");
  });

  it("saca una línea legible de la entrada, sin HTML y recortada", () => {
    expect(detalleDePaso({ tipo: "page", id: 7, nuevo_titulo: "<b>Nuestra historia</b>" })).toBe(
      "Nuestra historia",
    );
    expect(detalleDePaso({ slug: "litespeed-cache" })).toBe("litespeed-cache");
    expect(detalleDePaso({ cambio: { tipo: "anadir_enlace", texto: "Política de privacidad" } })).toBe(
      "Política de privacidad",
    );
    expect(detalleDePaso({ titulo: "x".repeat(200) })?.length).toBeLessThanOrEqual(90);
  });

  it("nunca enseña credenciales ni entradas sin claves conocidas", () => {
    expect(detalleDePaso({ appPassword: "abcd efgh ijkl", token: "secreto" })).toBeNull();
    expect(detalleDePaso("texto suelto")).toBeNull();
    expect(detalleDePaso(null)).toBeNull();
  });
});

describe("fusión por id", () => {
  it("actualiza el paso existente sin moverlo y conserva cuándo empezó y su detalle", () => {
    const inicio = [
      paso({ id: "a", detalle: "Inicio" }),
      paso({ id: "b", herramienta: "wp_listar_plugins", etiqueta: "Revisando los plugins" }),
    ];
    const fusion = fusionarPasos(inicio, paso({ id: "a", estado: "hecho", en: "2026-09-11T10:00:05.000Z" }));
    expect(fusion.map((p) => p.id)).toEqual(["a", "b"]);
    expect(fusion[0]).toMatchObject({ estado: "hecho", detalle: "Inicio", en: "2026-09-11T10:00:00.000Z" });
    expect(fusionarPasos(inicio, paso({ id: "c" })).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("reconoce pasos válidos y descarta basura de la base", () => {
    expect(esPasoTrabajo(paso({ id: "a" }))).toBe(true);
    expect(esPasoTrabajo({ id: "a", estado: "volando" })).toBe(false);
  });
});

describe("reconstrucción desde la conversación guardada", () => {
  it("marca hecho lo que tiene resultado, error lo que falló y esperando lo que quedó a medias", () => {
    const en = "2026-09-11T09:00:00.000Z";
    const mensajes = [
      { role: "user", content: "TAREA APROBADA POR EL CLIENTE" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc_1", toolName: "wp_leer_contenido", input: { id: 7, titulo: "Inicio" } },
          { type: "tool-call", toolCallId: "tc_2", toolName: "wp_listar_plugins", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "tc_1", toolName: "wp_leer_contenido", output: { type: "json", value: {} } },
          {
            type: "tool-result",
            toolCallId: "tc_2",
            toolName: "wp_listar_plugins",
            output: { type: "error-text", value: "403 prohibido" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc_3", toolName: "wp_instalar_plugin", input: { slug: "litespeed-cache" } },
          { type: "tool-approval-request", approvalId: "ap_1", toolCallId: "tc_3" },
        ],
      },
    ];
    const pasos = pasosDesdeMensajes(mensajes, en);
    expect(pasos.map((p) => [p.herramienta, p.estado, p.detalle])).toEqual([
      ["wp_leer_contenido", "hecho", "Inicio"],
      ["wp_listar_plugins", "error", "403 prohibido"],
      ["wp_instalar_plugin", "esperando", "litespeed-cache"],
    ]);
    expect(pasos.every((p) => p.en === en)).toBe(true);
    expect(pasosDesdeMensajes(null, en)).toEqual([]);
  });
});
