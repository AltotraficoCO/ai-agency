/**
 * Los esquemas de las herramientas tienen que ser digeribles por cualquier
 * modelo, no solo por el que usemos hoy.
 *
 * Caso real (sep-2026): `wp_crear_usuario` declaraba el correo con `z.email()`,
 * cuyo JSON Schema lleva una expresion regular con comprobaciones hacia
 * delante `(?!`. OpenAI las rechaza, y como las herramientas viajan todas
 * juntas, CUALQUIER encargo del Webmaster moria con «Provider returned error»
 * sin decir que herramienta era. GLM las aceptaba, asi que el fallo aparecio
 * solo al cambiar de modelo.
 */
import { describe, expect, it } from "vitest";
import { toMcpDescriptor } from "@strappy/tools";
import { HERRAMIENTAS_WEBMASTER } from "../src/tools/index.js";

/** `(?=`, `(?!`, `(?<=` y `(?<!`. */
const MIRADAS = /\((\?=|\?!|\?<=|\?<!)/;

function patrones(nodo: unknown, ruta: string): { ruta: string; patron: string }[] {
  if (Array.isArray(nodo)) return nodo.flatMap((v, i) => patrones(v, `${ruta}[${i}]`));
  if (!nodo || typeof nodo !== "object") return [];
  const salida: { ruta: string; patron: string }[] = [];
  for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    if (clave === "pattern" && typeof valor === "string") salida.push({ ruta, patron: valor });
    else salida.push(...patrones(valor, `${ruta}.${clave}`));
  }
  return salida;
}

describe("esquemas de las herramientas", () => {
  const esquemas = HERRAMIENTAS_WEBMASTER.map((d) => ({
    slug: d.slug,
    parametros: toMcpDescriptor(d).inputSchema,
  }));

  it("ninguna expresion regular usa comprobaciones hacia delante o hacia atras", () => {
    const malas = esquemas.flatMap(({ slug, parametros }) =>
      patrones(parametros, slug)
        .filter(({ patron }) => MIRADAS.test(patron))
        .map(({ ruta, patron }) => `${ruta}: ${patron}`),
    );
    expect(malas).toEqual([]);
  });

  it("todas declaran un objeto con sus propiedades", () => {
    for (const { slug, parametros } of esquemas) {
      expect((parametros as { type?: string }).type, slug).toBe("object");
    }
  });
});
