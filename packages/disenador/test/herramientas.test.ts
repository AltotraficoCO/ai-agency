/**
 * Las herramientas del Diseñador, contra los dobles.
 *
 * Lo que se verifica aquí son las tres promesas que sostienen este agente:
 * que no deja nada en el sitio del cliente sin que una persona pulse un botón,
 * que no se come el saldo dibujando variaciones, y que los bytes de la imagen
 * nunca acaban dentro de la conversación del modelo.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import {
  imgGenerar,
  imgListarMedios,
  imgPublicar,
  imgVerEstilo,
  HERRAMIENTAS_DISENADOR,
} from "../src/tools/index.js";
import { huellaAccion } from "../src/aprobacion.js";
import { SCOPES_DISENADOR } from "../src/context.js";
import { armarPrompt, nombreDeArchivo } from "../src/formatos.js";
import { etiquetaDePaso } from "../src/pasos.js";
import type { DisenoContext, ImagenGenerada } from "../src/ports.js";
import {
  AprobacionesEnMemoria,
  ESTILO_DE_EJEMPLO,
  ImagenesEnMemoria,
  MediosEnMemoria,
  PNG_MINIMO,
} from "../src/testing/dobles.js";

const AHORA = new Date("2026-09-12T15:00:00.000Z");

function montar(o: { sinEstilo?: boolean; sinMedios?: boolean; maxImagenes?: number } = {}) {
  const imagenes = new ImagenesEnMemoria();
  const medios = new MediosEnMemoria();
  const approvals = new AprobacionesEnMemoria();
  const capturas: { titulo: string; base64: string; mimeType: string }[] = [];
  const borradores = new Map<string, ImagenGenerada>();
  const contador = { generadas: 0 };

  const diseno: DisenoContext = {
    conexionId: "con_1",
    taskId: "task_1",
    imagenes,
    ...(o.sinMedios ? {} : { medios }),
    ...(o.sinEstilo ? {} : { estilo: ESTILO_DE_EJEMPLO }),
    approvals,
    capturas: { push: (c) => capturas.push(c) },
    borradores,
    contador,
    maxImagenes: o.maxImagenes ?? 3,
    creditosPorImagen: 100,
  };

  const ctx: ToolContext = {
    workspaceId: "ws_1",
    agentRunId: "task_1",
    dryRun: false,
    scopes: SCOPES_DISENADOR,
    ports: {},
    now: () => AHORA,
    diseno,
  } as unknown as ToolContext;

  return { ctx, diseno, imagenes, medios, approvals, capturas, borradores };
}

const ejecutar = (
  herramienta: { execute?: unknown },
  ctx: ToolContext,
  entrada: unknown,
): Promise<Record<string, unknown>> =>
  (herramienta.execute as (c: ToolContext, e: unknown) => Promise<Record<string, unknown>>)(
    ctx,
    entrada,
  );

describe("mirar antes de dibujar", () => {
  it("da los colores reales del sitio y los formatos con su medida", async () => {
    const { ctx } = montar();
    const r = await ejecutar(imgVerEstilo, ctx, {});
    expect(r.estilo_medido).toBe(true);
    expect((r.colores as Record<string, string>).acento).toBe("#D09E1D");
    const formatos = r.formatos as { formato: string; medida: string }[];
    expect(formatos.find((f) => f.formato === "portada")?.medida).toBe("1200x630");
  });

  it("sin estilo medido lo dice, en vez de inventarse una paleta", async () => {
    const { ctx } = montar({ sinEstilo: true });
    const r = await ejecutar(imgVerEstilo, ctx, {});
    expect(r.estilo_medido).toBe(false);
    expect(String(r.nota)).toContain("No se pudieron medir");
  });

  it("enseña la biblioteca del cliente para no gastar créditos de más", async () => {
    const { ctx } = montar();
    const r = await ejecutar(imgListarMedios, ctx, { buscar: "equipo" });
    expect((r.imagenes as unknown[]).length).toBe(1);
    expect(String(r.nota)).toContain("no hace falta gastar créditos");
  });
});

describe("dibujar", () => {
  it("usa los colores de la marca y devuelve un borrador, no los bytes", async () => {
    const { ctx, imagenes, capturas, borradores } = montar();
    const r = await ejecutar(imgGenerar, ctx, {
      idea: "un escritorio de abogado con documentos y una lámpara cálida, vista cenital",
      formato: "portada",
    });

    // El prompt lleva la paleta medida: es lo que hace que no salga genérica.
    expect(imagenes.llamadas[0]?.prompt).toContain("#D09E1D");
    expect(imagenes.llamadas[0]?.medida).toEqual({ ancho: 1200, alto: 630 });

    // Lo que ve el modelo: un identificador corto y el coste. Nunca la imagen.
    expect(r.borrador_id).toBe("img_1");
    expect(r.creditos).toBe(100);
    expect(JSON.stringify(r)).not.toContain(PNG_MINIMO);

    // Lo que ve el cliente: la imagen, dentro del encargo.
    expect(capturas).toHaveLength(1);
    expect(capturas[0]?.base64).toBe(PNG_MINIMO);
    expect(borradores.get("img_1")?.mimeType).toBe("image/png");
  });

  it("no se come el saldo: al llegar al tope se niega y explica qué hacer", async () => {
    const { ctx } = montar({ maxImagenes: 1 });
    await ejecutar(imgGenerar, ctx, {
      idea: "una oficina luminosa con plantas y luz natural entrando por la ventana",
      formato: "cuadrada",
    });
    await expect(
      ejecutar(imgGenerar, ctx, {
        idea: "otra variación de la misma oficina pero con otro encuadre distinto",
        formato: "cuadrada",
      }),
    ).rejects.toThrow(/tope/i);
  });
});

describe("publicar en el sitio del cliente", () => {
  it("no sube nada sin que una persona lo apruebe", async () => {
    const { ctx, medios, approvals } = montar();
    await ejecutar(imgGenerar, ctx, {
      idea: "un escritorio de abogado con documentos y una lámpara cálida, vista cenital",
      formato: "portada",
    });

    const entrada = { borrador_id: "img_1", alt: "Escritorio de abogado con documentos" };
    const r = await ejecutar(imgPublicar, ctx, entrada);

    expect(r.requiere_aprobacion).toBe(true);
    expect(medios.subidas).toHaveLength(0);
    // Lo que lee la persona dice qué es y dónde va, no un identificador.
    expect(approvals.solicitudes[0]?.resumen).toContain("Escritorio de abogado");
    expect(approvals.solicitudes[0]?.resumen).toContain("elnegocio.com");
  });

  it("aprobada, sube la imagen y devuelve el id que sirve de imagen destacada", async () => {
    const { ctx, medios, approvals } = montar();
    await ejecutar(imgGenerar, ctx, {
      idea: "un escritorio de abogado con documentos y una lámpara cálida, vista cenital",
      formato: "portada",
    });
    const entrada = { borrador_id: "img_1", alt: "Escritorio de abogado con documentos" };
    approvals.decidir(huellaAccion("task_1", "img_publicar", entrada), "aprobada");

    const r = await ejecutar(imgPublicar, ctx, entrada);

    expect(r.publicada).toBe(true);
    expect(typeof r.imagen_id).toBe("number");
    expect(medios.subidas).toHaveLength(1);
    expect(medios.subidas[0]?.base64).toBe(PNG_MINIMO);
    // El texto alternativo nunca se pierde: es accesibilidad y es SEO.
    expect(medios.subidas[0]?.alt).toBe("Escritorio de abogado con documentos");
  });

  it("reemplazar una imagen existente se lo dice claro a la persona", async () => {
    const { ctx, approvals } = montar();
    await ejecutar(imgGenerar, ctx, {
      idea: "una fachada moderna de oficina al atardecer, con luz cálida",
      formato: "banner",
    });
    await ejecutar(imgPublicar, ctx, {
      borrador_id: "img_1",
      alt: "Fachada de la oficina al atardecer",
      reemplaza_id: 12,
    });
    expect(approvals.solicitudes[0]?.resumen).toContain("deja de verse");
  });

  it("solo se publica lo dibujado en este encargo", async () => {
    const { ctx } = montar();
    await expect(
      ejecutar(imgPublicar, ctx, { borrador_id: "img_9", alt: "Una imagen cualquiera de prueba" }),
    ).rejects.toThrow(/no tengo ninguna imagen/i);
  });

  it("sin sitio conectado explica qué falta en vez de reventar con jerga", async () => {
    const { ctx } = montar({ sinMedios: true });
    await ejecutar(imgGenerar, ctx, {
      idea: "un escritorio de abogado con documentos y una lámpara cálida, vista cenital",
      formato: "portada",
    });
    await expect(
      ejecutar(imgPublicar, ctx, { borrador_id: "img_1", alt: "Escritorio de abogado" }),
    ).rejects.toThrow(/conecte su sitio/i);
  });
});

describe("lo que lee el cliente", () => {
  it("los pasos se cuentan en su idioma, sin jerga de diseño", () => {
    for (const h of HERRAMIENTAS_DISENADOR) {
      const etiqueta = etiquetaDePaso(h.slug);
      expect(etiqueta).not.toMatch(/asset|render|prompt|px|base64/i);
    }
    expect(etiquetaDePaso("img_generar")).toBe("Dibujando la imagen");
  });

  it("el prompt prohíbe lo que arruina una imagen de empresa", () => {
    const prompt = armarPrompt({
      idea: "una oficina luminosa",
      formato: "portada",
      estilo: ESTILO_DE_EJEMPLO,
    });
    expect(prompt).toContain("No escribas texto largo");
    expect(prompt).toContain("No inventes logotipos");
    expect(prompt).toContain("1200x630");
  });

  it("el nombre del archivo sale limpio, sin acentos ni espacios", () => {
    expect(nombreDeArchivo("Portada del artículo sobre IA", "image/png")).toBe(
      "portada-del-articulo-sobre-ia.png",
    );
    expect(nombreDeArchivo("", "image/jpeg")).toBe("imagen.jpg");
  });
});
