/**
 * Páginas y header global con Elementor.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno } from "../comun.js";
import { requireWp } from "../../ports.js";
import { esBloqueo, evaluarSensibilidad, hacerBackup, puertaDeAprobacion, type Bloqueo } from "../../aprobacion.js";
import * as wp from "../../wordpress/client.js";
import { PALETA_POR_DEFECTO, construirBarra, construirSecciones, type SeccionSpec } from "../../wordpress/elementor.js";
import { conPaleta, leerDisenoDelSitio, resumirEstilo } from "../../wordpress/diseno.js";
import { exigirTituloValido } from "../../wordpress/titulos.js";
import { reservarCreacion } from "../../creaciones.js";
import { contarPalabras, conTituloDeEntradaEnHero, extractoDeSecciones, motivoArticuloIncompleto, motivoReescrituraDestructiva, palabrasDeElementor, palabrasDeSecciones } from "../../wordpress/articulo.js";
import { extractoInput, imagenDestacadaInput, cantidadPedida, tipoContenido, hex, portadaDe } from "./comun.js";

const itemSeccion = z.object({
  titulo: z.string().optional(),
  texto: z.string().optional(),
  icono: z
    .string()
    .optional()
    .describe("Ignorado: no se pintan emojis; las tarjetas se numeran con el color de acento del sitio."),
  cifra: z.string().optional().describe("Solo en stats, p.ej. '500+'"),
  etiqueta: z.string().optional().describe("Solo en stats"),
  autor: z.string().optional().describe("Solo en testimonios"),
  cargo: z.string().optional().describe("Solo en testimonios"),
  pregunta: z.string().optional().describe("Solo en faq"),
  respuesta: z.string().optional().describe("Solo en faq"),
});

const seccionSpec = z.object({
  tipo: z.enum(["hero", "beneficios", "stats", "testimonios", "precios", "faq", "cta", "texto"]),
  titulo: z.string().optional(),
  subtitulo: z.string().optional(),
  boton: z.string().optional(),
  boton_url: z
    .string()
    .optional()
    .describe(
      "Ruta del sitio (/contacto/) o dirección externa completa (https://…). Sin boton_url válido el botón NO se pinta: nunca inventes «Leer más» sin destino.",
    ),
  html: z.string().optional().describe("Solo para tipo texto"),
  items: z.array(itemSeccion).optional(),
  planes: z
    .array(
      z.object({
        nombre: z.string(),
        precio: z.string(),
        periodo: z.string().optional(),
        incluye: z.array(z.string()).min(2).max(8),
        boton: z.string().optional(),
        destacado: z.boolean().optional(),
      }),
    )
    .optional()
    .describe("Solo en tipo precios (2-3 planes)"),
});

export const wpCrearPaginaElementor = defineTool({
  slug: "wp_crear_pagina_elementor",
  label: "Crear página con Elementor",
  description:
    "Crea (o reescribe, pasando su id) una página o una entrada de blog (tipo=\"post\") construida CON ELEMENTOR componiendo secciones: hero, beneficios, stats, testimonios, precios, faq, cta y texto. El diseño (colores, tipografías, radios, botones, ancho) se toma AUTOMÁTICAMENTE del sitio real, para que quede acorde a lo que ya tiene. Oculta el título duplicado del tema y cierra los comentarios salvo que se pidan. Para una landing decente usa 5-8 secciones variadas con copy concreto del negocio: una página de tres bloques es inaceptable. UNA ENTRADA (tipo=\"post\") ES UN ARTÍCULO COMPLETO: hero con el mismo titular de la entrada (sin botón o con el CTA real del sitio) → texto de introducción → 3-5 secciones texto con subtítulos y desarrollo → opcional beneficios o faq → cta con la llamada a la acción real del sitio; mínimo 400 palabras, o se rechaza. Dale también imagen_destacada_id (elígela con wp_listar_medios): el listado del blog pinta cada tarjeta con la imagen destacada, el título y el extracto, y sin ellos la entrada sale ahí vacía; el extracto se genera solo del artículo si no lo pasas. Crea UN contenido nuevo por tarea salvo que pases cantidad_pedida. Para mejorar uno existente, pasa su id y el contenido COMPLETO: una reescritura con mucho menos texto se rechaza. Es la herramienta obligatoria cuando piden algo 'con Elementor', 'de diseño' o 'atractivo', también para una entrada.",
  whenToUse: "para cualquier landing, página de ventas, rediseño o entrada de blog con aspecto profesional",
  inputSchema: z.object({
    titulo: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "Titular redactado por ti a partir del TEMA: completo, atractivo y de 90 caracteres como mucho. Nunca un trozo copiado de la petición ni instrucciones de formato.",
      ),
    tipo: tipoContenido
      .optional()
      .describe(
        '"post" para una entrada o artículo de blog, "page" para una página. Sin id, por defecto crea una página. Con id y sin tipo, se detecta.',
      ),
    pagina_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Si se pasa, escribe el diseño SOBRE ese contenido existente (página o entrada) y conserva su URL."),
    contenido_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Lo mismo que pagina_id, con un nombre que vale también para entradas."),
    secciones: z.array(seccionSpec).min(1).max(10),
    extracto: extractoInput,
    imagen_destacada_id: imagenDestacadaInput,
    paleta: z
      .object({
        fondo: hex.describe("Hexadecimal oscuro"),
        acento: hex.describe("Hexadecimal vivo"),
        texto: hex.describe("Hexadecimal claro"),
        fondo_claro: hex,
      })
      .optional()
      .describe("SOLO si el cliente pidió expresamente otro estilo o hay una referencia de imagen; exige motivo_paleta."),
    motivo_paleta: z
      .enum(["el_cliente_pidio_otro_estilo", "referencia_de_imagen"])
      .optional()
      .describe("Por qué no se usa el diseño del sitio. Sin motivo, la paleta se ignora."),
    referencia_diseno: z
      .string()
      .startsWith("/", "Ruta relativa del sitio, p.ej. /servicios/")
      .max(300)
      .optional()
      .describe("Página de la que copiar el diseño. Por defecto, la portada."),
    permitir_comentarios: z
      .boolean()
      .default(false)
      .describe("true solo si el cliente quiere comentarios debajo; por defecto se cierran."),
    cantidad_pedida: cantidadPedida,
    reemplazar_todo: z
      .boolean()
      .default(false)
      .describe("true SOLO si el cliente pidió reemplazar por completo un contenido existente, aunque quede con menos texto."),
  }),
  sensitive: false,
  creditCost: 8,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_pagina_elementor");
    const creds = requireWp(sitio, "wp_crear_pagina_elementor");
    exigirTituloValido(input.titulo);

    if (
      input.pagina_id !== undefined &&
      input.contenido_id !== undefined &&
      input.pagina_id !== input.contenido_id
    ) {
      throw new Error(
        `pagina_id (${input.pagina_id}) y contenido_id (${input.contenido_id}) no coinciden: pasa solo uno de los dos.`,
      );
    }
    const id = input.contenido_id ?? input.pagina_id;
    // Un contenido nuevo ocupa su plaza ANTES de cualquier await: dos llamadas
    // en paralelo no pueden crear dos entradas cuando se pidió una.
    const reserva =
      id === undefined
        ? reservarCreacion(sitio, {
            tipo: input.tipo ?? "page",
            titulo: input.titulo,
            cantidadPedida: input.cantidad_pedida,
          })
        : null;

    const trabajo = async (): Promise<Bloqueo | Record<string, unknown>> => {
      // Con un id, el tipo no se adivina: se lee. Así una entrada recién creada
      // no acaba pidiéndose por /pages/ hasta agotar el tope de acciones.
      const tipo =
        id === undefined ? (input.tipo ?? "page") : (input.tipo ?? (await wp.detectarTipoContenido(creds, id, opciones)));
      const antes = id !== undefined ? await wp.leerContenido(creds, tipo, id, opciones) : undefined;

      const pedidas = input.secciones as SeccionSpec[];
      // Una entrada de un hero y un botón que no lleva a nada no es un artículo.
      if (tipo === "post") {
        const incompleto = motivoArticuloIncompleto(pedidas);
        if (incompleto) throw new Error(incompleto);
      }

      // Lo que ya había: para el backup y para no destruirlo al reescribir.
      const disenoAnterior =
        id !== undefined ? await wp.leerElementorData(creds, id, opciones, tipo).catch(() => null) : null;
      if (id !== undefined && antes && !input.reemplazar_todo) {
        const palabrasAntes = disenoAnterior ? palabrasDeElementor(disenoAnterior) : contarPalabras(antes.contenido);
        const destructiva = motivoReescrituraDestructiva(id, palabrasAntes, palabrasDeSecciones(pedidas));
        if (destructiva) throw new Error(destructiva);
      }
      const { secciones, cambiado: heroRetitulado } =
        tipo === "post" ? conTituloDeEntradaEnHero(pedidas, input.titulo) : { secciones: pedidas, cambiado: false };

      const portadaId = id !== undefined && tipo === "page" ? await portadaDe(creds, opciones) : undefined;
      const bloqueo = await puertaDeAprobacion(
        ctx,
        sitio,
        "wp_crear_pagina_elementor",
        input,
        evaluarSensibilidad({
          toolSlug: "wp_crear_pagina_elementor",
          titulo: input.titulo,
          ...(id !== undefined ? { contenidoId: id } : {}),
          ...(portadaId !== undefined ? { portadaId } : {}),
          tiposSeccion: input.secciones.map((s) => s.tipo),
        }),
      );
      if (bloqueo) return bloqueo;

      let backupId: string | null = null;
      if (id !== undefined && antes) {
        backupId = await hacerBackup(ctx, sitio, `${tipo}:${id}`, {
          tipo,
          id,
          titulo: antes.titulo,
          contenido: antes.contenido,
          status: antes.status,
          ...(disenoAnterior ? { elementor_data: disenoAnterior } : {}),
        });
      }

      // El diseño sale del sitio. Una paleta del modelo solo vale con motivo:
      // «bonita» no es pedir otro estilo, y era así como salía negro y naranja.
      const delSitio = await leerDisenoDelSitio(sitio, opciones, input.referencia_diseno ?? "/");
      const usarPaleta = input.paleta !== undefined && input.motivo_paleta !== undefined;
      const estilo = usarPaleta ? conPaleta(delSitio, input.paleta!) : delSitio;

      // Sin extracto ni imagen destacada la entrada se publica bien, pero su
      // tarjeta sale vacía en el listado del blog: el extracto se saca del
      // propio artículo cuando el modelo no lo manda.
      const extracto =
        input.extracto ?? (tipo === "post" ? extractoDeSecciones(secciones) : "");

      const data = construirSecciones(secciones, estilo);
      const r = await wp.escribirContenidoElementor(
        creds,
        {
          tipo,
          ...(id !== undefined ? { id } : {}),
          titulo: input.titulo,
          data,
          ...(extracto ? { extracto } : {}),
          ...(input.imagen_destacada_id !== undefined
            ? { imagenDestacadaId: input.imagen_destacada_id }
            : {}),
        },
        opciones,
      );
      if (!r.elementorOk) {
        throw new Error(
          "El WordPress no aceptó el diseño Elementor: falta el plugin conector, que es quien expone los metadatos de Elementor en la REST API. El cliente lo descarga desde el panel.",
        );
      }
      const presentacion = await wp.ajustarPresentacion(
        creds,
        tipo,
        r.id,
        {
          ocultarTitulo: true,
          comentarios: input.permitir_comentarios ? "open" : "closed",
          ...(extracto ? { extracto } : {}),
          ...(input.imagen_destacada_id !== undefined
            ? { imagenDestacadaId: input.imagen_destacada_id }
            : {}),
        },
        opciones,
      );

      const notas = ["Verifica ahora con navegador_ver_pagina (pagina_completa=true) y compárala con la portada: si no se parece, corrígela."];
      if (input.paleta && !usarPaleta) {
        notas.push("Ignoré la paleta porque no diste motivo_paleta: se usó el diseño del sitio.");
      }
      if (estilo.origen === "por_defecto") {
        notas.push("No pude leer el diseño del sitio y usé el aspecto por defecto: revisa la portada y, si no se parece, repite con una paleta y motivo_paleta.");
      }
      if (!presentacion.tituloOculto) {
        notas.push("No pude ocultar el título del tema: si al verlo aparece repetido encima del diseño, dilo en el RESUMEN.");
      }
      if (heroRetitulado) notas.push("Puse en el hero el mismo titular que la entrada.");
      if (tipo === "post") {
        if (presentacion.imagenDestacada <= 0) {
          notas.push(
            "La entrada NO tiene imagen destacada: en el listado del blog su tarjeta saldrá sin foto y, con algunas plantillas, vacía. Elige una con wp_listar_medios y repite esta llamada con contenido_id e imagen_destacada_id, o ponla con wp_editar_contenido.",
          );
        }
        if (extracto && !presentacion.extracto) {
          notas.push("No pude guardar el extracto: sin él la tarjeta del blog sale sin texto. Inténtalo con wp_editar_contenido (nuevo_extracto).");
        }
      }
      if (tipo === "post" && id === undefined) {
        notas.push("Cuando la hayas verificado, enlázala en el blog del sitio con wp_enlazar_entrada_en_blog (su id y un extracto de 1-2 frases) y mira el listado del blog en el navegador. No crees más entradas salvo que el cliente pidiera varias.");
      }
      return {
        ok: true,
        tipo,
        id: r.id,
        link: r.link,
        secciones: secciones.length,
        palabras: palabrasDeSecciones(secciones),
        backup_id: backupId,
        diseno_origen: estilo.origen,
        estilo_aplicado: resumirEstilo(estilo),
        titulo_del_tema_oculto: presentacion.tituloOculto,
        comentarios: presentacion.comentarios,
        extracto: presentacion.extracto || extracto || null,
        imagen_destacada: presentacion.imagenDestacada,
        nota: notas.join(" "),
      };
    };

    try {
      const resultado = await trabajo();
      if (reserva) {
        if (esBloqueo(resultado) || typeof resultado.id !== "number") reserva.liberar();
        else reserva.confirmar(resultado.id);
      }
      return resultado;
    } catch (error) {
      reserva?.liberar();
      throw error;
    }
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      titulo: input.titulo,
      secciones: input.secciones.map((s) => s.tipo),
      nota: "Simulación: la página no se escribió. Describe estas secciones en el plan.",
    };
  },
});

export const wpCrearHeaderGlobal = defineTool({
  slug: "wp_crear_header_global",
  label: "Crear header (y footer) global",
  description:
    "Crea el HEADER —y opcionalmente el FOOTER— GLOBAL del sitio con Elementor: un template que sale en TODAS las páginas. Un header nunca es una página ni un post. Requiere el plugin conector en el WordPress. El diseño de la barra lo compone la plataforma; tú eliges marca, enlaces y paleta.",
  whenToUse: "cuando pidan un menú, cabecera o pie que se vea en todo el sitio",
  inputSchema: z.object({
    marca: z.string().min(1).max(80).describe("Nombre corto del negocio que va en la barra"),
    enlaces: z
      .array(
        z.object({
          texto: z.string().min(1).max(40),
          // Un footer con el Instagram del negocio o un "Llámanos" es lo normal:
          // la restricción a rutas relativas es de las herramientas de
          // navegador (que no deben visitar otros hosts), no de un enlace.
          url: z
            .string()
            .max(500)
            .refine(
              (v) => v.startsWith("/") || /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i.test(v),
              "Usa una ruta del sitio (/contacto/) o una dirección completa (https://…, mailto:…, tel:…).",
            )
            .describe("Ruta de una página del sitio (/contacto/) o dirección externa completa con https://"),
        }),
      )
      .min(2)
      .max(6),
    paleta: z.object({ fondo: hex, acento: hex, texto: hex }).optional(),
    incluir_footer: z.boolean().default(false),
  }),
  sensitive: false,
  creditCost: 8,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_header_global");
    const creds = requireWp(sitio, "wp_crear_header_global");
    const pal = input.paleta ?? {
      fondo: PALETA_POR_DEFECTO.fondo,
      acento: PALETA_POR_DEFECTO.acento,
      texto: PALETA_POR_DEFECTO.texto,
    };

    const header = await wp.crearHeaderElementor(
      creds,
      {
        titulo: "Header del sitio",
        tipo: "header",
        data: construirBarra({
          marca: input.marca,
          enlaces: input.enlaces,
          paleta: pal,
          variante: "header",
        }),
      },
      opciones,
    );
    if (!header.disponible) {
      throw new Error(
        "No se puede crear un header o footer global NUEVO en este sitio. Si el sitio ya tiene su header o footer hecho con Elementor, edítalo con wp_listar_plantillas_elementor, wp_leer_plantilla_elementor y wp_editar_plantilla_elementor. No crees páginas ni posts como rodeo.",
      );
    }

    let footerId: number | undefined;
    if (input.incluir_footer) {
      const f = await wp.crearHeaderElementor(
        creds,
        {
          titulo: "Footer del sitio",
          tipo: "footer",
          data: construirBarra({
            marca: input.marca,
            enlaces: input.enlaces,
            paleta: pal,
            variante: "footer",
          }),
        },
        opciones,
      );
      if (f.disponible) footerId = f.id;
    }

    return {
      ok: true,
      header_id: header.id,
      ...(footerId ? { footer_id: footerId } : {}),
      nota: "Verifica con navegador_ver_pagina que la barra se vea bien en la portada y en otra página.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      marca: input.marca,
      enlaces: input.enlaces.length,
      nota: "Simulación: el header no se creó.",
    };
  },
});
