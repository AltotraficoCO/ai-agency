/**
 * Enlazar una entrada nueva en el blog del sitio.
 *
 * Existe porque las entradas se publicaban y no aparecían en ningún sitio: el
 * blog del cliente era un diseño estático de Elementor con tarjetas de relleno.
 * La decisión de qué hacer (nada, rellenar una tarjeta o añadir «Artículos
 * recientes») es pura y vive en `wordpress/blog.ts`; aquí se lee, se pide
 * aprobación si toca, se guarda backup y se escribe.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno } from "./comun.js";
import { requireWp } from "../ports.js";
import { evaluarSensibilidad, hacerBackup, puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import * as wp from "../wordpress/client.js";
import { leerDisenoDelSitio } from "../wordpress/diseno.js";
import type { NodoElementor } from "../wordpress/plantillas.js";
import {
  buscarTarjetasDeRelleno,
  elegirTarjeta,
  enlazaA,
  insertarEntradaReciente,
  rellenarTarjeta,
  tarjetasDeImagen,
  tieneListadoDinamico,
} from "../wordpress/blog.js";

const SLUG_BLOG = /^(blog|noticias|articulos|actualidad|novedades)$/;

export const wpEnlazarEntradaEnBlog = defineTool({
  slug: "wp_enlazar_entrada_en_blog",
  label: "Enlazar una entrada en el blog",
  description:
    "Hace que una entrada ya publicada aparezca en la página del blog del sitio. Si el blog lista las entradas solo, no toca nada. Si es un diseño de Elementor con tarjetas de relleno («[Título del artículo]»), rellena UNA con el título, el extracto y el enlace, conservando la foto. Si no hay tarjetas de texto (p. ej. son imágenes), añade o amplía una sección «Artículos recientes» con el estilo del sitio. Guarda backup del diseño anterior.",
  whenToUse: "siempre después de crear y verificar una entrada de blog nueva",
  inputSchema: z.object({
    entrada_id: z.number().int().positive().describe("Id de la entrada ya publicada."),
    extracto: z
      .string()
      .min(40)
      .max(320)
      .describe("1-2 frases que resumen la entrada, redactadas por ti para invitar a leerla."),
    categoria: z
      .string()
      .min(2)
      .max(60)
      .optional()
      .describe("Tema de la entrada para elegir la tarjeta más afín (p. ej. «Derecho Laboral»). Si no encaja ninguna, se usa la primera."),
    pagina_blog_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Solo si el blog no es la página de entradas de WordPress ni la página con slug blog."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_enlazar_entrada_en_blog");
    const creds = requireWp(sitio, "wp_enlazar_entrada_en_blog");

    const entrada = await wp.leerContenido(creds, "post", input.entrada_id, opciones);
    if (entrada.status !== "publish") {
      throw new Error(
        `La entrada ${input.entrada_id} está en «${entrada.status}»: publícala antes de enlazarla en el blog.`,
      );
    }

    const ajustes = await wp.leerAjustes(creds, opciones).catch(() => ({}) as Record<string, unknown>);
    const numero = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
    const paginaDeEntradas = numero(ajustes.page_for_posts);
    const portadaId = numero(ajustes.page_on_front);
    const base = { ok: true, entrada: { id: entrada.id, titulo: entrada.titulo, link: entrada.link } };

    let blogId = input.pagina_blog_id ?? paginaDeEntradas;
    if (blogId === undefined) {
      const paginas = (await wp.listarContenido(creds, opciones)).filter((c) => c.tipo === "page");
      blogId = (paginas.find((p) => SLUG_BLOG.test(p.slug)) ?? paginas.find((p) => p.slug.includes("blog")))?.id;
    }
    if (blogId === undefined) {
      return {
        ...base,
        enlazada: false,
        modo: "sin_pagina_de_blog",
        nota: "El sitio no tiene página de blog (ni página de entradas ni una página con slug blog): la entrada se ve en su URL. Dilo en el RESUMEN.",
      };
    }
    if (blogId === paginaDeEntradas && input.pagina_blog_id === undefined) {
      return {
        ...base,
        enlazada: true,
        modo: "listado_automatico",
        pagina_blog_id: blogId,
        nota: "Es la página de entradas de WordPress: las lista sola. Compruébalo con navegador_ver_pagina.",
      };
    }

    const pagina = await wp.leerContenido(creds, "page", blogId, opciones);
    const data = (await wp.leerElementorData(creds, blogId, opciones, "page")) as NodoElementor[] | null;
    const conPagina = { ...base, pagina_blog: pagina.link, pagina_blog_id: blogId };
    if (!data) {
      return {
        ...conPagina,
        enlazada: false,
        modo: "blog_sin_elementor",
        nota: "La página del blog no está hecha con Elementor o no expone su diseño por la API: no la toqué. Dilo en el RESUMEN.",
      };
    }
    if (tieneListadoDinamico(data)) {
      return {
        ...conPagina,
        enlazada: true,
        modo: "listado_dinamico",
        nota: "El blog lista las entradas con un widget de Elementor: la nueva aparece sola. Compruébalo con navegador_ver_pagina.",
      };
    }
    if (enlazaA(data, entrada.link, entrada.id)) {
      return { ...conPagina, enlazada: true, modo: "ya_estaba", nota: "La página del blog ya enlazaba esta entrada." };
    }

    const datosEntrada = {
      titulo: entrada.titulo,
      extracto: input.extracto,
      url: entrada.link,
      categoria: input.categoria,
    };
    const tarjetas = buscarTarjetasDeRelleno(data);
    let nueva: NodoElementor[];
    let modo: "tarjeta_rellenada" | "seccion_entradas_recientes";
    let detalle: Record<string, unknown>;
    const notas: string[] = [];

    if (tarjetas.length > 0) {
      const tarjeta = elegirTarjeta(tarjetas, input.categoria);
      const r = rellenarTarjeta(data, tarjeta, datosEntrada);
      nueva = r.data;
      modo = "tarjeta_rellenada";
      detalle = {
        tarjeta: tarjeta.contenedor,
        etiquetas_de_la_tarjeta: tarjeta.etiquetas,
        tarjetas_de_relleno_restantes: tarjetas.length - 1,
      };
      if (r.quedanDeRelleno > 0) {
        notas.push(`En la tarjeta quedan ${r.quedanDeRelleno} textos de relleno que no supe a qué corresponden: revísala al verla.`);
      }
    } else {
      const estilo = await leerDisenoDelSitio(sitio, opciones, "/");
      const r = insertarEntradaReciente(data, datosEntrada, estilo);
      const imagenes = tarjetasDeImagen(data).total;
      nueva = r.data;
      modo = "seccion_entradas_recientes";
      detalle = { seccion: r.seccion, seccion_ya_existia: r.yaExistia, tarjetas_de_imagen_sin_enlace: imagenes };
      notas.push(
        r.yaExistia
          ? "Añadí la entrada, la primera, a la sección «Artículos recientes» del blog."
          : "Añadí al blog una sección «Artículos recientes» con la entrada, con el estilo del sitio.",
      );
      if (imagenes > 0) {
        notas.push(
          `Las ${imagenes} tarjetas que ya había en el blog son IMÁGENES sin enlace (el texto de relleno está pintado dentro): no se pueden editar como texto ni llevan a ninguna entrada. Dilo en el RESUMEN y recomienda sustituirlas.`,
        );
      }
    }

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "wp_enlazar_entrada_en_blog",
      input,
      evaluarSensibilidad({
        toolSlug: "wp_enlazar_entrada_en_blog",
        titulo: pagina.titulo,
        slug: pagina.slug,
        contenido: input.extracto,
        contenidoId: blogId,
        ...(portadaId !== undefined ? { portadaId } : {}),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `page:${blogId}`, {
      tipo: "page",
      id: blogId,
      titulo: pagina.titulo,
      contenido: pagina.contenido,
      status: pagina.status,
      elementor_data: data,
    });
    const { cache } = await wp.escribirElementorDeContenido(creds, "page", blogId, nueva, opciones);
    notas.push(`Verifica ahora el blog con navegador_ver_pagina (${new URL(pagina.link || "https://x/").pathname}, pagina_completa=true).`);

    return {
      ...conPagina,
      enlazada: true,
      modo,
      ...detalle,
      backup_id: backupId,
      cache,
      nota: notas.join(" "),
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      entrada_id: input.entrada_id,
      nota: "Simulación: el blog no se tocó. Describe en el plan cómo quedaría enlazada la entrada.",
    };
  },
});

export const HERRAMIENTAS_BLOG: readonly ToolDef<never, unknown>[] = [
  wpEnlazarEntradaEnBlog,
] as unknown as readonly ToolDef<never, unknown>[];
