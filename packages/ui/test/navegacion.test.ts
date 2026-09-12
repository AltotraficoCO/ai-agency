/**
 * El menú es por DEPARTAMENTOS, que es como piensa quien dirige la empresa.
 *
 * Lo que se prueba aquí es lo que decide qué ve la persona: dónde cae cada
 * agente, qué departamento se abre según dónde estés y que ninguna pantalla del
 * menú se quede huérfana.
 */
import { describe, expect, it } from "vitest";
import {
  DEPARTAMENTOS,
  DEPARTAMENTOS_CON_PANTALLA,
  DEPARTAMENTO_POR_DEFECTO,
  departamentoDeCategoria,
  esDepartamentoConPantalla,
} from "../src/layout/departamentos.js";
import {
  destinosPrincipales,
  entradaDeGrupo,
  esGrupoNav,
  menuPrincipal,
  rutaDeDepartamento,
  rutas,
  todosLosDestinos,
  type GrupoNav,
} from "../src/layout/navigation.js";

const grupos = menuPrincipal.filter(esGrupoNav);
const grupo = (id: string): GrupoNav => {
  const encontrado = grupos.find((g) => g.id === id);
  if (!encontrado) throw new Error(`No hay departamento "${id}" en el menú`);
  return encontrado;
};

describe("departamento de cada categoría", () => {
  it("reparte las categorías que hoy tiene el catálogo", () => {
    // Las de la semilla: Recepcionista, Webmaster y Marketing.
    expect(departamentoDeCategoria("ventas")).toBe("comunicaciones");
    expect(departamentoDeCategoria("operaciones")).toBe("desarrollo");
    expect(departamentoDeCategoria("crecimiento")).toBe("marketing");
    expect(departamentoDeCategoria("finanzas")).toBe("financiero");
    // El departamento se renombró a Financiero: la categoría vieja sigue
    // valiendo para que un agente ya guardado con ella no quede huérfano.
    expect(departamentoDeCategoria("administracion")).toBe("financiero");
  });

  it("no se pierde por mayúsculas ni por espacios", () => {
    expect(departamentoDeCategoria("  Crecimiento ")).toBe("marketing");
  });

  it("una categoría nueva cae en el departamento por defecto, no desaparece", () => {
    // El fallo que esto previene: contratar un agente con una categoría que el
    // menú no conoce y que no salga en ninguna pantalla.
    expect(departamentoDeCategoria("recursos_humanos")).toBe(DEPARTAMENTO_POR_DEFECTO);
    expect(departamentoDeCategoria(null)).toBe(DEPARTAMENTO_POR_DEFECTO);
    expect(departamentoDeCategoria(undefined)).toBe(DEPARTAMENTO_POR_DEFECTO);
    expect(departamentoDeCategoria("")).toBe(DEPARTAMENTO_POR_DEFECTO);
  });

  it("todos los departamentos tienen ficha y ruta", () => {
    for (const id of Object.keys(DEPARTAMENTOS) as (keyof typeof DEPARTAMENTOS)[]) {
      expect(DEPARTAMENTOS[id].etiqueta.length).toBeGreaterThan(0);
      expect(rutaDeDepartamento[id]).toBeTruthy();
    }
  });

  it("solo son pantalla propia los departamentos que la tienen", () => {
    expect(DEPARTAMENTOS_CON_PANTALLA).toEqual(["marketing", "desarrollo", "financiero"]);
    expect(esDepartamentoConPantalla("marketing")).toBe(true);
    // Comunicaciones tiene la suya de siempre, en /whatsapp/agentes.
    expect(esDepartamentoConPantalla("comunicaciones")).toBe(false);
    expect(esDepartamentoConPantalla("inventado")).toBe(false);
  });
});

describe("el menú", () => {
  it("enseña los departamentos en el orden del negocio", () => {
    expect(grupos.map((g) => g.id)).toEqual([
      "comunicaciones",
      "marketing",
      "desarrollo",
      "financiero",
    ]);
  });

  it("deja fuera de los departamentos lo que es de la empresa entera", () => {
    const sueltos = menuPrincipal.filter((e) => !esGrupoNav(e)).map((e) => e.id);
    expect(sueltos).toEqual(["inicio", "agentes", "impacto"]);
  });

  it("Comunicaciones agrupa la atención al cliente", () => {
    expect(grupo("comunicaciones").destinos.map((d) => d.href)).toEqual([
      rutas.agentesWhatsapp,
      rutas.bandeja,
      rutas.contactos,
      rutas.conocimiento,
      rutas.analitica,
    ]);
  });

  it("cada departamento con pantalla propia enlaza a su ruta", () => {
    expect(grupo("marketing").destinos[0]?.href).toBe(rutas.marketing);
    expect(grupo("desarrollo").destinos[0]?.href).toBe(rutas.desarrollo);
    expect(grupo("financiero").destinos[0]?.href).toBe(rutas.financiero);
  });

  it("ningún destino del menú se queda fuera de los que se pueden marcar", () => {
    for (const destino of destinosPrincipales) {
      expect(todosLosDestinos).toContain(destino);
    }
  });

  it("no hay dos entradas con la misma ruta", () => {
    const href = todosLosDestinos.map((d) => d.href);
    expect(new Set(href).size).toBe(href.length);
  });
});

describe("un departamento de una sola pantalla", () => {
  it("se enseña como enlace directo, con el nombre del departamento", () => {
    // Dos clics para llegar a lo mismo es lo que esto evita.
    const directo = entradaDeGrupo(grupo("marketing"));
    expect(directo?.etiqueta).toBe("Marketing");
    expect(directo?.href).toBe(rutas.marketing);
  });

  it("cuando tiene varias, sigue siendo desplegable", () => {
    expect(entradaDeGrupo(grupo("comunicaciones"))).toBeNull();
  });
});

describe("qué departamento se abre solo", () => {
  const abiertoEn = (ruta: string, g: GrupoNav) => g.destinos.some((d) => d.href === ruta);

  it("el que contiene la pantalla en la que estás", () => {
    expect(abiertoEn(rutas.bandeja, grupo("comunicaciones"))).toBe(true);
    expect(abiertoEn(rutas.bandeja, grupo("marketing"))).toBe(false);
  });

  it("ninguno cuando estás en algo de la empresa entera", () => {
    for (const g of grupos) {
      expect(abiertoEn(rutas.impacto, g)).toBe(false);
      expect(abiertoEn(rutas.agentes, g)).toBe(false);
    }
  });
});
