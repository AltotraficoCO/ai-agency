import { describe, expect, it } from "vitest";
import {
  MAXIMO_POR_ENCARGO,
  MINIMO_POR_ENCARGO,
  TARIFA_POR_DEFECTO,
  TRABAJOS,
  ahorroDeMinutos,
  estimarEncargo,
  formatearHoras,
  leerAjustesImpacto,
  repartirPorTipo,
  resumirImpacto,
  retornoDe,
  tipoDeHerramienta,
  variacion,
  type EncargoParaImpacto,
} from "./impacto-calculo";

describe("tipo de trabajo por herramienta", () => {
  it("las lecturas cuentan como revisión aunque toquen plantillas", () => {
    expect(tipoDeHerramienta("wp_leer_plantilla_elementor")).toBe("revision");
    expect(tipoDeHerramienta("wp_listar_plugins")).toBe("revision");
    expect(tipoDeHerramienta("navegador_ver_pagina")).toBe("revision");
    expect(tipoDeHerramienta("sitio_salud")).toBe("revision");
  });

  it("clasifica las escrituras por lo que cambian", () => {
    expect(tipoDeHerramienta("wp_editar_plantilla_elementor")).toBe("diseno");
    expect(tipoDeHerramienta("wp_crear_header_global")).toBe("diseno");
    expect(tipoDeHerramienta("wp_editar_contenido")).toBe("contenido");
    expect(tipoDeHerramienta("wp_subir_media")).toBe("contenido");
    expect(tipoDeHerramienta("wp_cambiar_plugin")).toBe("plugins");
    expect(tipoDeHerramienta("wp_eliminar_plugin")).toBe("plugins");
    expect(tipoDeHerramienta("wp_restaurar_contenido")).toBe("copias");
    expect(tipoDeHerramienta("wp_actualizar_ajustes")).toBe("ajustes");
    expect(tipoDeHerramienta("wp_moderar_comentario")).toBe("usuarios");
  });

  it("preguntar o pedir permiso no es trabajo", () => {
    expect(tipoDeHerramienta("preguntar_al_cliente")).toBeNull();
    expect(tipoDeHerramienta("pedir_aprobacion")).toBeNull();
  });
});

describe("minutos por encargo", () => {
  it("cuenta cada tipo UNA vez por encargo", () => {
    const estimacion = estimarEncargo({
      titulo: "Añadir enlace al pie",
      herramientas: [
        "wp_listar_plantillas_elementor",
        "wp_leer_plantilla_elementor",
        "wp_editar_plantilla_elementor",
        "wp_editar_plantilla_elementor",
      ],
    });
    expect(new Set(estimacion.tipos)).toEqual(new Set(["revision", "diseno"]));
    expect(estimacion.minutos).toBe(TRABAJOS.revision.minutos + TRABAJOS.diseno.minutos);
    expect(estimacion.porTitulo).toBe(false);
  });

  it("aplica el mínimo por encargo", () => {
    const estimacion = estimarEncargo({ titulo: "Revisar el sitio", herramientas: ["sitio_salud"] });
    expect(estimacion.minutos).toBe(Math.max(MINIMO_POR_ENCARGO, TRABAJOS.revision.minutos));
  });

  it("aplica el máximo por encargo", () => {
    const estimacion = estimarEncargo({
      titulo: "Todo",
      herramientas: [
        "wp_editar_plantilla_elementor",
        "wp_editar_contenido",
        "wp_cambiar_plugin",
        "wp_restaurar_contenido",
        "wp_crear_usuario",
        "wp_actualizar_ajustes",
        "sitio_salud",
        "enviar_campana",
        "algo_nuevo",
        "otra_cosa_mas",
      ],
    });
    expect(estimacion.minutos).toBeLessThanOrEqual(MAXIMO_POR_ENCARGO);
  });

  it("sin herramientas estima por las palabras del título", () => {
    const estimacion = estimarEncargo({ titulo: "Cambiar el pie de página y desactivar un plugin", herramientas: [] });
    expect(estimacion.porTitulo).toBe(true);
    expect(new Set(estimacion.tipos)).toEqual(new Set(["diseno", "plugins"]));
  });

  it("un título sin pistas cuenta como «otro»", () => {
    const estimacion = estimarEncargo({ titulo: "Hola", herramientas: [] });
    expect(estimacion.tipos).toEqual(["otro"]);
    expect(estimacion.minutos).toBe(Math.max(MINIMO_POR_ENCARGO, TRABAJOS.otro.minutos));
  });

  it("el reparto por tipo suma el total aunque haya mínimo", () => {
    const estimacion = estimarEncargo({ titulo: "x", herramientas: ["wp_cambiar_plugin"] });
    const suma = [...repartirPorTipo(estimacion).values()].reduce((s, m) => s + m, 0);
    expect(suma).toBeCloseTo(estimacion.minutos);
  });
});

describe("dinero", () => {
  it("ahorro = horas × tarifa", () => {
    expect(ahorroDeMinutos(90, 8)).toBe(12);
  });

  it("usa la moneda de la empresa y su tarifa por defecto si no hay nada guardado", () => {
    const ajustes = leerAjustesImpacto({}, "COP");
    expect(ajustes.moneda).toBe("COP");
    expect(ajustes.tarifaHora).toBe(TARIFA_POR_DEFECTO.COP);
    expect(ajustes.personalizada).toBe(false);
    expect(ajustes.usdAMoneda).toBeNull();
  });

  it("respeta la tarifa guardada", () => {
    const ajustes = leerAjustesImpacto({ impacto: { tarifa_hora: 12, moneda: "USD" } }, "COP");
    expect(ajustes).toEqual({ moneda: "USD", tarifaHora: 12, usdAMoneda: 1, personalizada: true });
  });

  it("el retorno en USD compara directo con el coste", () => {
    const ajustes = leerAjustesImpacto({ impacto: { tarifa_hora: 8, moneda: "USD" } }, null);
    expect(retornoDe({ ahorro: 40, costeUsd: 2, ajustes })).toBe(20);
  });

  it("en otra moneda no inventa el tipo de cambio", () => {
    const sin = leerAjustesImpacto({ impacto: { tarifa_hora: 30000, moneda: "COP" } }, null);
    expect(retornoDe({ ahorro: 100000, costeUsd: 2, ajustes: sin })).toBeNull();
    const con = leerAjustesImpacto({ impacto: { tarifa_hora: 30000, moneda: "COP", usd_a_moneda: 4000 } }, null);
    expect(retornoDe({ ahorro: 80000, costeUsd: 2, ajustes: con })).toBe(10);
  });

  it("sin coste no hay retorno", () => {
    const ajustes = leerAjustesImpacto({}, "USD");
    expect(retornoDe({ ahorro: 40, costeUsd: 0, ajustes })).toBeNull();
  });

  it("la variación necesita base", () => {
    expect(variacion(10, 0)).toBeNull();
    expect(variacion(15, 10)).toBeCloseTo(0.5);
  });

  it("formatea horas legibles", () => {
    expect(formatearHoras(45)).toBe("45 min");
    expect(formatearHoras(120)).toBe("2 h");
    expect(formatearHoras(150)).toBe("2 h 30 min");
  });
});

describe("resumen de un periodo", () => {
  const ajustes = leerAjustesImpacto({ impacto: { tarifa_hora: 6, moneda: "USD" } }, null);
  const encargo = (parcial: Partial<EncargoParaImpacto> & { id: string; dia: string }): EncargoParaImpacto => ({
    agenteId: "web",
    titulo: "Cambio",
    terminado: `${parcial.dia}T15:00:00Z`,
    herramientas: ["wp_editar_contenido"],
    creditos: 500,
    ...parcial,
  });

  it("separa el periodo actual del anterior y acumula el ahorro por día", () => {
    const resumen = resumirImpacto({
      rango: { desde: "2026-09-08", hasta: "2026-09-10" },
      anterior: { desde: "2026-09-05", hasta: "2026-09-07" },
      ajustes,
      encargos: [
        encargo({ id: "a", dia: "2026-09-08" }),
        encargo({ id: "b", dia: "2026-09-10", herramientas: ["wp_editar_plantilla_elementor"] }),
        encargo({ id: "c", dia: "2026-09-06" }),
      ],
    });

    expect(resumen.actual.completados).toBe(2);
    expect(resumen.anterior.completados).toBe(1);
    // 15 min de contenido + 25 min de diseño = 40 min = 4 USD a 6 USD/h.
    expect(resumen.actual.minutos).toBe(40);
    expect(resumen.actual.ahorro).toBeCloseTo(4);
    expect(resumen.actual.costeUsd).toBe(1);
    expect(resumen.actual.retorno).toBeCloseTo(4);
    expect(resumen.serie.map((p) => p.completados)).toEqual([1, 0, 1]);
    expect(resumen.serie.at(-1)?.ahorroAcumulado).toBeCloseTo(4);
    expect(resumen.recientes.map((e) => e.id)).toEqual(["b", "a"]);
    expect(resumen.porTipo[0]?.tipo).toBe("diseno");
  });
});
