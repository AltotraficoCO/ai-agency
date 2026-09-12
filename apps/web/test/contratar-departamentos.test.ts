/**
 * Contratar se lee como una plantilla: por departamentos.
 *
 * Se prueba con los agentes reales del catálogo (semilla 0010 y migración 0028)
 * porque lo que importa es que un agente nuevo caiga donde debe sin que nadie
 * toque la pantalla.
 */
import { describe, expect, it } from "vitest";
import {
  agruparPorDepartamento,
  conexionesPendientes,
  resumenDePlantilla,
  type CandidatoUbicable,
} from "@/lib/negocio/contratar-departamentos";

const webmaster: CandidatoUbicable = {
  slug: "webmaster",
  categoria: "operaciones",
  contratado: true,
  conexiones: [{ nombre: "Tu sitio web", lista: true }],
};

const marketing: CandidatoUbicable = {
  slug: "marketing",
  categoria: "crecimiento",
  contratado: false,
  conexiones: [
    { nombre: "Google Ads", lista: false },
    { nombre: "Facebook e Instagram", lista: false },
    { nombre: "Conocimiento", lista: true },
  ],
};

const administrativo: CandidatoUbicable = {
  slug: "administrativo",
  categoria: "facturacion",
  contratado: false,
  conexiones: [{ nombre: "Alegra", lista: false }],
};

describe("agrupar el catálogo por departamentos", () => {
  it("cada agente cae en su departamento, en el orden del menú", () => {
    const grupos = agruparPorDepartamento([webmaster, marketing, administrativo]);
    expect(grupos.map((g) => g.id)).toEqual(["marketing", "desarrollo", "financiero"]);
  });

  it("un departamento sin candidatos no se enseña vacío", () => {
    const grupos = agruparPorDepartamento([webmaster]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.id).toBe("desarrollo");
    // Comunicaciones nunca sale: los agentes de WhatsApp no se contratan.
    expect(grupos.some((g) => g.id === "comunicaciones")).toBe(false);
  });

  it("separa quién ya trabaja aquí de quién se puede contratar, sin repetirlo", () => {
    const grupos = agruparPorDepartamento([webmaster, marketing]);
    const desarrollo = grupos.find((g) => g.id === "desarrollo")!;
    const mkt = grupos.find((g) => g.id === "marketing")!;

    expect(desarrollo.contratados.map((f) => f.slug)).toEqual(["webmaster"]);
    expect(desarrollo.disponibles).toEqual([]);
    expect(mkt.contratados).toEqual([]);
    expect(mkt.disponibles.map((f) => f.slug)).toEqual(["marketing"]);
  });

  it("lleva el nombre y la descripción del departamento, los mismos del menú", () => {
    const [grupo] = agruparPorDepartamento([webmaster]);
    expect(grupo!.etiqueta).toBe("Desarrollo");
    expect(grupo!.descripcion).toContain("web");
  });

  it("un agente con una categoría que todavía no conocemos no desaparece", () => {
    const disenador: CandidatoUbicable = {
      slug: "disenador",
      categoria: "ilustracion",
      contratado: false,
      conexiones: [],
    };
    const grupos = agruparPorDepartamento([disenador]);
    expect(grupos.map((g) => g.id)).toEqual(["otros"]);
    expect(grupos[0]!.disponibles.map((f) => f.slug)).toEqual(["disenador"]);
  });

  it("con el catálogo vacío no hay grupos", () => {
    expect(agruparPorDepartamento([])).toEqual([]);
  });
});

describe("qué le falta conectado", () => {
  it("solo lo que no está listo, por su nombre", () => {
    expect(conexionesPendientes(marketing)).toEqual(["Google Ads", "Facebook e Instagram"]);
  });

  it("nada pendiente cuando ya está todo conectado", () => {
    expect(conexionesPendientes(webmaster)).toEqual([]);
  });
});

describe("resumen de la plantilla", () => {
  it("cuenta los puestos cubiertos sobre el catálogo entero", () => {
    expect(resumenDePlantilla([webmaster, marketing, administrativo])).toEqual({
      contratados: 1,
      total: 3,
    });
  });
});
