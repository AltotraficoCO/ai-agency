/**
 * Los esquemas de las herramientas los lee el modelo, y no todos aceptan lo
 * mismo.
 *
 * Caso real (sep-2026): una herramienta del Webmaster declaraba el correo con
 * `z.email()`, cuyo JSON Schema lleva una expresion regular con comprobaciones
 * hacia delante `(?!`. OpenAI las rechaza y, como las herramientas viajan todas
 * juntas, el turno entero moria con «Provider returned error» sin decir cual
 * era. GLM las aceptaba: el fallo aparecio al cambiar de modelo.
 */
import { describe, expect, it } from "vitest";
import { SYSTEM_TOOLS, toMcpDescriptor } from "../src/index.js";

/** `(?=`, `(?!`, `(?<=` y `(?<!`. */
const MIRADAS = /\((\?=|\?!|\?<=|\?<!)/;

function patrones(nodo: unknown, ruta: string): { ruta: string; patron: string }[] {
  if (Array.isArray(nodo)) return nodo.flatMap((v, i) => patrones(v, `${ruta}[${i}]`));
  if (!nodo || typeof nodo !== 'object') return [];
  const salida: { ruta: string; patron: string }[] = [];
  for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    if (clave === 'pattern' && typeof valor === 'string') salida.push({ ruta, patron: valor });
    else salida.push(...patrones(valor, `${ruta}.${clave}`));
  }
  return salida;
}

describe('esquemas de las herramientas de sistema', () => {
  const esquemas = SYSTEM_TOOLS.map((d) => ({
    slug: d.slug,
    parametros: toMcpDescriptor(d).inputSchema,
  }));

  it('hay herramientas registradas', () => {
    expect(esquemas.length).toBeGreaterThan(0);
  });

  it('ninguna expresion regular usa comprobaciones hacia delante o hacia atras', () => {
    const malas = esquemas.flatMap(({ slug, parametros }) =>
      patrones(parametros, slug)
        .filter(({ patron }) => MIRADAS.test(patron))
        .map(({ ruta, patron }) => `${ruta}: ${patron}`),
    );
    expect(malas).toEqual([]);
  });
});
