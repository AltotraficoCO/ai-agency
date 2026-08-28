/**
 * Elegir una opción no pasa por el modelo.
 *
 * Esta es la prueba de que la regla «nunca preguntes algo que ya sabes» es una
 * garantía y no una súplica: la respuesta se convierte en borrador con una
 * función pura, determinista, que se puede leer entera.
 */
import { describe, expect, it } from "vitest";
import { esquemaBorradorAgente, fusionarBorrador, huecosDeLaFase, capacidadAgenteMensajeria } from "@strappy/core";
import { frasearRespuestas, respuestasAParcial } from "./respuestas";

describe("respuestas a borrador", () => {
  it("escribe una ruta anidada", () => {
    expect(respuestasAParcial([{ clave: "empresa.nombre", valores: ["La Espiga"] }])).toEqual({
      empresa: { nombre: "La Espiga" },
    });
  });

  it("convierte las claves de `recoger` en campos con etiqueta legible", () => {
    const parcial = respuestasAParcial([
      { clave: "recoger", valores: ["nombre", "telefono", "interes"] },
    ]);
    expect(parcial["recoger"]).toEqual([
      { clave: "nombre", etiqueta: "nombre", obligatorio: true },
      { clave: "telefono", etiqueta: "teléfono", obligatorio: true },
      { clave: "interes", etiqueta: "producto de interés", obligatorio: false },
    ]);
  });

  it("varias respuestas a una pregunta escalar se conservan enteras", () => {
    expect(respuestasAParcial([{ clave: "agente.tono", valores: ["cercano", "breve"] }])).toEqual({
      agente: { tono: "cercano, breve" },
    });
  });

  it("ignora respuestas en blanco en vez de guardar huecos", () => {
    expect(respuestasAParcial([{ clave: "empresa.sitioWeb", valores: ["  "] }])).toEqual({});
  });

  it("una respuesta cierra su pregunta: la fase deja de pedirla", () => {
    const vacio = esquemaBorradorAgente.parse({});
    const antes = huecosDeLaFase({
      capacidad: capacidadAgenteMensajeria,
      fase: "recoleccion_1",
      borrador: vacio,
    });
    expect(antes).toContain("empresa.nombre");

    const despues = fusionarBorrador(
      esquemaBorradorAgente,
      vacio,
      respuestasAParcial([{ clave: "empresa.nombre", valores: ["La Espiga"] }]),
    );
    expect(
      huecosDeLaFase({
        capacidad: capacidadAgenteMensajeria,
        fase: "recoleccion_1",
        borrador: despues,
      }),
    ).not.toContain("empresa.nombre");
  });

  it("frasea lo elegido con las etiquetas que vio la persona", () => {
    expect(
      frasearRespuestas([{ clave: "canal", valores: ["whatsapp"] }], { whatsapp: "WhatsApp" }),
    ).toBe("WhatsApp");
  });
});
