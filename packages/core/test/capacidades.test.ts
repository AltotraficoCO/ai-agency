/**
 * Pruebas de lo sutil del meta-agente.
 *
 * No se prueba que una capacidad tenga las fases que tiene —eso es un dato y
 * lo verifica leerlo—. Se prueban las tres cosas cuyo fallo es silencioso y
 * caro: que el borrador sobrevive a una recarga, que una pregunta ya
 * respondida no vuelve, y que el prompt publicado es reproducible.
 */
import { describe, expect, it } from "vitest";
import {
  BORRADOR_AGENTE_VACIO,
  BorradorInvalidoError,
  ETIQUETA_FASE,
  FASES_META,
  borradorAEspecificacion,
  capacidadAgenteMensajeria,
  capacidadDelBorrador,
  esFaseMeta,
  esquemaBorradorAgente,
  faseCompleta,
  faseParaColumna,
  fusionarBorrador,
  huecosDeLaFase,
  preguntasPendientes,
  registrarCapacidades,
  siguienteFase,
  valorEnRuta,
  type BorradorAgente,
} from "../src/capabilities/index.js";
import { compilePrompt, computePromptHash, type PromptSpec } from "../src/prompt/index.js";

const cap = capacidadAgenteMensajeria;

describe("el registro de capacidades", () => {
  it("se puede llamar dos veces sin lanzar", () => {
    registrarCapacidades();
    registrarCapacidades();
    expect(capacidadDelBorrador(null).slug).toBe(cap.slug);
    expect(capacidadDelBorrador(cap.slug).slug).toBe(cap.slug);
  });

  it("declara las doce herramientas de Strap y una verificación real", () => {
    expect(cap.tools).toHaveLength(12);
    expect(cap.tools).toContain("publicar_agente");
    expect(cap.verify.kind).toBe("simulator");
  });

  it("ninguna fase pide más de tres cosas", () => {
    for (const fase of cap.phases) {
      expect(fase.questions.length).toBeLessThanOrEqual(3);
    }
  });

  it("toda pregunta cerrada lleva opciones", () => {
    for (const fase of cap.phases) {
      for (const pregunta of fase.questions) {
        const abierta = pregunta.allowFreeText === true;
        expect(abierta || (pregunta.options?.length ?? 0) > 0).toBe(true);
      }
    }
  });
});

describe("las fases", () => {
  it("avanzan en orden y se quedan en la entrega", () => {
    expect(siguienteFase("intencion")).toBe("recoleccion_1");
    expect(siguienteFase("prueba")).toBe("entrega");
    expect(siguienteFase("entrega")).toBe("entrega");
  });

  it("todas tienen etiqueta y proyección a la columna del esquema", () => {
    for (const fase of FASES_META) {
      expect(ETIQUETA_FASE[fase]).toBeTruthy();
      expect(esFaseMeta(fase)).toBe(true);
      expect(
        ["discovery", "company", "persona", "knowledge", "tools", "channels", "review", "published"],
      ).toContain(faseParaColumna(fase));
    }
    expect(esFaseMeta("inventada")).toBe(false);
  });
});

describe("el borrador sobrevive a una recarga", () => {
  it("un ida y vuelta por JSON no pierde ni cambia nada", () => {
    const borrador = fusionarBorrador(esquemaBorradorAgente, BORRADOR_AGENTE_VACIO, {
      empresa: { nombre: "Panadería La Espiga", sitioWeb: "https://espiga.co" },
      agente: { nombre: "Espiga", tono: "cercano y breve, tutea" },
      canal: "whatsapp",
      hace: ["Responde por precios del catálogo"],
      recoger: [{ clave: "nombre", etiqueta: "nombre", obligatorio: true }],
    }) as BorradorAgente;

    const recuperado = esquemaBorradorAgente.parse(
      JSON.parse(JSON.stringify(borrador)),
    ) as BorradorAgente;

    expect(recuperado).toEqual(borrador);
    expect(recuperado.empresa?.nombre).toBe("Panadería La Espiga");
    expect(recuperado.recoger[0]?.clave).toBe("nombre");
  });

  it("la mezcla es parcial: lo que no llega se conserva", () => {
    const uno = fusionarBorrador(esquemaBorradorAgente, BORRADOR_AGENTE_VACIO, {
      empresa: { nombre: "Espiga", sector: "comercio" },
    });
    const dos = fusionarBorrador(esquemaBorradorAgente, uno, {
      empresa: { horario: "24/7" },
    }) as BorradorAgente;

    expect(dos.empresa?.nombre).toBe("Espiga");
    expect(dos.empresa?.sector).toBe("comercio");
    expect(dos.empresa?.horario).toBe("24/7");
  });

  it("las listas se reemplazan, para que se pueda quitar un elemento", () => {
    const uno = fusionarBorrador(esquemaBorradorAgente, BORRADOR_AGENTE_VACIO, {
      hace: ["a", "b", "c"],
    });
    const dos = fusionarBorrador(esquemaBorradorAgente, uno, { hace: ["a"] }) as BorradorAgente;
    expect(dos.hace).toEqual(["a"]);
  });

  it("rechaza un parcial que rompe el esquema en vez de guardar basura", () => {
    expect(() =>
      fusionarBorrador(esquemaBorradorAgente, BORRADOR_AGENTE_VACIO, { canal: "paloma_mensajera" }),
    ).toThrow(BorradorInvalidoError);
  });
});

describe("no se repite una pregunta ya respondida", () => {
  it("descarta la que ya está en el borrador", () => {
    const borrador = esquemaBorradorAgente.parse({
      agente: { proposito: "vender" },
      canal: "whatsapp",
    }) as BorradorAgente;

    const pendientes = preguntasPendientes({ capacidad: cap, fase: "intencion", borrador });
    const claves = pendientes.map((p) => p.key);

    expect(claves).not.toContain("agente.proposito");
    expect(claves).not.toContain("canal");
    expect(claves).toContain("empresa.sitioWeb");
  });

  it("descarta la que ya está en la ficha de la empresa, aunque el borrador esté vacío", () => {
    const pendientes = preguntasPendientes({
      capacidad: cap,
      fase: "recoleccion_1",
      borrador: BORRADOR_AGENTE_VACIO,
      yaSabido: ["empresa.nombre", "empresa.sector"],
    });
    expect(pendientes.map((p) => p.key)).toEqual(["empresa.horario"]);
  });

  it("una cadena en blanco no cuenta como respuesta", () => {
    const borrador = esquemaBorradorAgente.parse({ agente: { nombre: "   " } }) as BorradorAgente;
    expect(huecosDeLaFase({ capacidad: cap, fase: "recoleccion_2", borrador })).toContain(
      "agente.nombre",
    );
  });

  it("nunca ofrece más de tres por ronda", () => {
    const pendientes = preguntasPendientes({
      capacidad: cap,
      fase: "intencion",
      borrador: BORRADOR_AGENTE_VACIO,
    });
    expect(pendientes.length).toBeLessThanOrEqual(3);
  });

  it("una fase sin huecos se declara completa", () => {
    const borrador = esquemaBorradorAgente.parse({
      empresa: { nombre: "Espiga", sector: "comercio", horario: "24/7" },
    }) as BorradorAgente;
    expect(faseCompleta({ capacidad: cap, fase: "recoleccion_1", borrador })).toBe(true);
    expect(faseCompleta({ capacidad: cap, fase: "recoleccion_2", borrador })).toBe(false);
  });

  it("lee rutas anidadas sin lanzar cuando el camino no existe", () => {
    expect(valorEnRuta({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(valorEnRuta({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(valorEnRuta(null, "a")).toBeUndefined();
  });
});

describe("el prompt publicado es reproducible", () => {
  const borrador = esquemaBorradorAgente.parse({
    empresa: { nombre: "Panadería La Espiga", sector: "comercio", horario: "24/7" },
    agente: {
      nombre: "Espiga",
      idioma: "español",
      tono: "cercano y breve, tutea",
      proposito: "atender pedidos por WhatsApp",
    },
    objetivo: "cerrar el pedido y confirmar la entrega",
    hace: ["Responde precios del catálogo", "Toma pedidos"],
    noHace: ["No promete descuentos"],
    recoger: [{ clave: "nombre", etiqueta: "nombre", obligatorio: true }],
    escalar: ["Si el cliente se queja de un pedido"],
  }) as BorradorAgente;

  const aSpec = (b: BorradorAgente): PromptSpec => {
    const spec = borradorAEspecificacion(b);
    return {
      agent: {
        name: spec.identidad.nombre,
        language: spec.identidad.idioma,
        tone: spec.identidad.tono,
        purpose: spec.identidad.proposito,
      },
      company: { name: b.empresa?.nombre ?? "", hours: b.empresa?.horario ?? "" },
      instructions: spec.hace.map((h) => `- ${h}`).join("\n"),
      ...(spec.objetivo ? { goal: spec.objetivo } : {}),
      collect: spec.recoger.map((c) => ({ key: c.clave, label: c.etiqueta, required: true })),
    };
  };

  it("el mismo borrador da el mismo hash, siempre", () => {
    const a = computePromptHash(aSpec(borrador));
    const b = computePromptHash(aSpec(esquemaBorradorAgente.parse(JSON.parse(JSON.stringify(borrador))) as BorradorAgente));
    expect(b).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambiar el borrador cambia el hash", () => {
    const a = computePromptHash(aSpec(borrador));
    const otro = fusionarBorrador(esquemaBorradorAgente, borrador, {
      agente: { tono: "profesional y cordial, trata de usted" },
    }) as BorradorAgente;
    expect(computePromptHash(aSpec(otro))).not.toBe(a);
  });

  it("el hash del compilado y el del spec coinciden", () => {
    const spec = aSpec(borrador);
    expect(compilePrompt(spec).hash).toBe(computePromptHash(spec));
  });

  it("la traducción a especificación no inventa campos vacíos", () => {
    const spec = borradorAEspecificacion(BORRADOR_AGENTE_VACIO as BorradorAgente);
    expect(spec.identidad.nombre).toBe("Asistente");
    expect(spec.hace).toEqual([]);
    expect(spec.instruccionesManuales).toBeUndefined();
  });
});
