/**
 * «Mejorar con IA» no puede perder el trabajo de nadie.
 *
 * El riesgo de este botón no es que proponga algo flojo: es que sobrescriba en
 * silencio lo que el dueño del negocio escribió. Por eso lo que se prueba aquí
 * no es la calidad de la redacción —eso lo juzga la persona en la pantalla—,
 * sino que aplicar una propuesta conserva todo lo que no se aceptó.
 */
import { describe, expect, it } from "vitest";
import { leerEspecificacion, type EspecificacionAgente } from "@strappy/db/spec";
import {
  SISTEMA_MEJORA,
  aplicarMejora,
  cambiosDeLaMejora,
  entradaDeMejora,
  esquemaMejora,
  fichaSinContenido,
} from "@/lib/agentes/mejora";

const FICHA: EspecificacionAgente = leerEspecificacion({
  identidad: {
    nombre: "Espiga",
    idioma: "español",
    tono: "cercano",
    proposito: "atender a quien escribe",
  },
  hace: ["Responde precios"],
  noHace: ["No inventa precios"],
  recoger: [{ clave: "ciudad", etiqueta: "ciudad de entrega" }],
  escalar: ["Cuando se quejan"],
  variables: { sucursal: "centro" },
  instruccionesManuales: "Texto escrito a mano por la persona.",
});

describe("aplicar una mejora", () => {
  it("no pierde nada de lo que la mejora no toca", () => {
    const resultado = aplicarMejora(
      FICHA,
      { hace: ["Responde precios solo si están en el catálogo"], resumen: "x" },
      ["hace"],
    );

    expect(resultado.hace).toEqual(["Responde precios solo si están en el catálogo"]);
    // Todo lo demás, intacto: nombre, datos a recoger, variables y el texto
    // que la persona escribió a mano.
    expect(resultado.identidad.nombre).toBe("Espiga");
    expect(resultado.identidad.proposito).toBe("atender a quien escribe");
    expect(resultado.recoger).toEqual(FICHA.recoger);
    expect(resultado.variables).toEqual({ sucursal: "centro" });
    expect(resultado.instruccionesManuales).toBe("Texto escrito a mano por la persona.");
    expect(resultado.noHace).toEqual(["No inventa precios"]);
    expect(resultado.escalar).toEqual(["Cuando se quejan"]);
  });

  it("una sección rechazada se queda exactamente como estaba", () => {
    const resultado = aplicarMejora(
      FICHA,
      { hace: ["otra cosa"], noHace: ["otro límite"], resumen: "x" },
      ["noHace"],
    );

    expect(resultado.hace).toEqual(["Responde precios"]);
    expect(resultado.noHace).toEqual(["otro límite"]);
  });

  it("sin secciones aceptadas no cambia nada", () => {
    expect(aplicarMejora(FICHA, { hace: ["otra cosa"], resumen: "x" }, [])).toEqual(FICHA);
  });

  it("nunca cambia el nombre del agente, aunque el modelo lo intentara", () => {
    // El esquema no admite `identidad.nombre`: la única defensa que no depende
    // de que el modelo obedezca el prompt.
    const analisis = esquemaMejora.safeParse({
      identidad: { nombre: "Otro nombre", proposito: "algo" },
      resumen: "x",
    });
    expect(analisis.success).toBe(true);
    const resultado = aplicarMejora(FICHA, analisis.data!, ["identidad"]);
    expect(resultado.identidad.nombre).toBe("Espiga");
  });

  it("una línea vacía no borra una sección que tenía contenido", () => {
    const resultado = aplicarMejora(FICHA, { hace: ["   ", ""], resumen: "x" }, ["hace"]);
    expect(resultado.hace).toEqual(["Responde precios"]);
  });
});

describe("qué se enseña como cambio", () => {
  it("repetir lo que ya había no cuenta como cambio", () => {
    const cambios = cambiosDeLaMejora(FICHA, {
      hace: ["Responde precios"],
      identidad: { proposito: "atender a quien escribe", tono: "cercano" },
      resumen: "x",
    });
    expect(cambios).toEqual([]);
  });

  it("cada sección cambiada trae su antes y su después", () => {
    const cambios = cambiosDeLaMejora(FICHA, {
      hace: ["Responde precios solo si están en el catálogo"],
      resumen: "x",
    });
    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.seccion).toBe("hace");
    expect(cambios[0]!.antes).toEqual(["Responde precios"]);
    expect(cambios[0]!.despues).toEqual(["Responde precios solo si están en el catálogo"]);
  });

  it("los datos a recoger no se proponen nunca", () => {
    // Su clave la usan las automatizaciones y la ficha del contacto: que un
    // modelo la renombre rompería integraciones sin que nadie se entere.
    const analisis = esquemaMejora.safeParse({
      recoger: [{ clave: "otra", etiqueta: "otra" }],
      resumen: "x",
    });
    expect(analisis.success).toBe(true);
    expect(analisis.data).not.toHaveProperty("recoger");
  });
});

describe("lo que se le pide al modelo", () => {
  it("el sistema prohíbe inventar datos y prometer cosas", () => {
    expect(SISTEMA_MEJORA).toContain("Inventar datos del negocio");
    expect(SISTEMA_MEJORA).toContain("promesas comerciales");
    expect(SISTEMA_MEJORA).toContain("Cambiar el nombre del agente");
  });

  it("la entrada lleva la ficha entera y el nombre marcado como intocable", () => {
    const entrada = entradaDeMejora(FICHA);
    expect(entrada).toContain("Espiga");
    expect(entrada).toContain("No lo cambies");
    expect(entrada).toContain("Responde precios");
    expect(entrada).toContain("Cuando se quejan");
  });

  it("con la ficha casi vacía se pide un punto de partida", () => {
    const vacia = leerEspecificacion({ identidad: { nombre: "Nuevo" } });
    expect(fichaSinContenido(vacia)).toBe(true);
    expect(entradaDeMejora(vacia)).toContain("propón un punto de partida");
  });
});
