/**
 * Lo que el cliente responde al contratar tiene que ACABAR MANDANDO ALGO.
 *
 * El fallo que esto previene es el que había: el asistente preguntaba cuatro
 * cosas, las guardaba en el contrato y ningún agente las leía nunca. Un ajuste
 * que no cambia el comportamiento es peor que no preguntarlo, porque el cliente
 * cree que configuró su agente.
 */
import { describe, expect, it } from "vitest";
import { instruccionesDeAjustes } from "@/lib/negocio/ajustes-agente";

describe("los ajustes del cliente se vuelven instrucciones", () => {
  it("el administrativo recibe las cuatro respuestas como reglas", () => {
    const r = instruccionesDeAjustes("administrativo", {
      dias_atraso: "15",
      puede_emitir: "preparar",
      impuesto: "iva19",
      cuenta_cobro: "Bancolombia Corriente",
    });

    expect(r.hace.join(" ")).toContain("15 días");
    expect(r.hace.join(" ")).toContain("IVA del 19%");
    expect(r.hace.join(" ")).toContain("Bancolombia Corriente");
    // Elegir «solo las deja listas» tiene que PROHIBIR emitir, no solo sugerirlo.
    expect(r.noHace.join(" ")).toContain("No emites ninguna factura");
  });

  it("permitir emitir no deja ninguna prohibición contradictoria", () => {
    const r = instruccionesDeAjustes("administrativo", { puede_emitir: "emitir" });
    expect(r.hace.join(" ")).toContain("cuando el cliente aprueba");
    expect(r.noHace).toEqual([]);
  });

  it("el velocista sin permiso para instalar lo tiene prohibido por escrito", () => {
    const r = instruccionesDeAjustes("velocista", { puede_instalar: "proponer" });
    expect(r.noHace.join(" ")).toContain("No instalas");
  });

  it("las páginas del velocista llegan en una sola línea, aunque vengan en varias", () => {
    const r = instruccionesDeAjustes("velocista", {
      paginas_clave: "  /precios \n\n /contacto \n",
    });
    expect(r.hace).toEqual(["Además de la portada, mides estas páginas: /precios, /contacto."]);
  });

  it("el diseñador que solo entrega no puede subir nada al sitio", () => {
    const r = instruccionesDeAjustes("disenador", { estilo: "marca", puede_publicar: "entregar" });
    expect(r.hace.join(" ")).toContain("colores y el aire de la web");
    expect(r.noHace).toEqual(["No subes imágenes al sitio."]);
  });

  it("reportes recibe el día y el periodo", () => {
    const r = instruccionesDeAjustes("reportes", { dia_informe: "lunes", periodo: "7" });
    expect(r.hace).toEqual([
      "El informe se entrega los lunes.",
      "Cada informe mira los últimos 7 días.",
    ]);
  });

  it("lo que el cliente no quiere oír se prohíbe, no se sugiere", () => {
    const r = instruccionesDeAjustes("marketing", { no_mencionar: "descuentos\nla competencia" });
    expect(r.noHace).toEqual(["No mencionas nunca: descuentos la competencia."]);
  });

  it("una respuesta vacía no escribe una regla vacía", () => {
    const r = instruccionesDeAjustes("administrativo", { cuenta_cobro: "   " });
    expect(r).toEqual({ hace: [], noHace: [] });
  });

  it("un valor que no reconocemos no se inventa como regla", () => {
    const r = instruccionesDeAjustes("administrativo", { impuesto: "lo_que_sea", dias_atraso: "pronto" });
    expect(r).toEqual({ hace: [], noHace: [] });
  });

  it("un agente sin ajustes declarados no rompe nada", () => {
    expect(instruccionesDeAjustes("agente_que_no_existe", { algo: "x" })).toEqual({
      hace: [],
      noHace: [],
    });
    expect(instruccionesDeAjustes("disenador", {})).toEqual({ hace: [], noHace: [] });
  });

  it("el mismo ajuste produce siempre el mismo orden de frases", () => {
    const uno = instruccionesDeAjustes("administrativo", { impuesto: "exento", dias_atraso: "8" });
    const otro = instruccionesDeAjustes("administrativo", { dias_atraso: "8", impuesto: "exento" });
    expect(uno).toEqual(otro);
    expect(uno.hace[0]).toContain("8 días");
  });

  it("la dirección del sitio no se repite en el prompt del webmaster", () => {
    // Sale de la conexión de WordPress: escribirla también aquí crearía una
    // segunda verdad que puede quedar vieja.
    const r = instruccionesDeAjustes("webmaster", {
      sitio: "https://ejemplo.com",
      frecuencia: "6h",
      avisar_a: "ana@ejemplo.com",
    });
    expect(r.hace.join(" ")).not.toContain("ejemplo.com/");
    expect(r.hace.join(" ")).toContain("cada 6 horas");
    expect(r.hace.join(" ")).toContain("ana@ejemplo.com");
  });
});
