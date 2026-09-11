/**
 * Barrido: cada herramienta, una vez, contra el doble.
 *
 * Los tests de extremo a extremo ejercitan el camino que recorre una tarea
 * real, pero solo tocan ocho o nueve herramientas. Sin este barrido, las otras
 * treinta estarían solo tipadas, y "compila" no es lo mismo que "funciona":
 * un `_fields` mal escrito o una ruta con la ese de más responden 404 y el
 * agente lo descubriría en el sitio de un cliente.
 *
 * Aquí se llama a cada una con una entrada válida y se comprueba que devuelve
 * lo que dice devolver. Lo que este barrido NO prueba es que un WordPress de
 * verdad responda igual que el doble; para eso está
 * `apps/worker/scripts/probar-sitio.ts`.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import {
  HERRAMIENTAS_WEBMASTER,
  SCOPES_CONECTOR,
  SCOPES_WORDPRESS,
  webmasterToolRegistry,
  type SitioContext,
} from "../src/index.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_DOBLE,
  crearDobleWordPress,
  NavegadorFalso,
} from "../src/testing/index.js";

/** Entradas válidas para cada herramienta de WordPress y de navegador. */
const ENTRADAS_WP: Record<string, unknown> = {
  sitio_salud: {},
  wp_listar_contenido: {},
  wp_leer_contenido: { tipo: "page", id: 7 },
  wp_listar_plugins: {},
  wp_leer_ajustes: {},
  wp_listar_comentarios: { estado: "hold" },
  wp_listar_usuarios: {},
  wp_editar_contenido: { tipo: "page", id: 7, nuevo_titulo: "Historia renovada" },
  wp_crear_contenido: {
    tipo: "post",
    titulo: "Novedades del horno",
    contenido_html: "<p>Hola.</p>",
    status: "publish",
  },
  wp_borrar_contenido: { tipo: "post", id: 21 },
  wp_restaurar_contenido: { tipo: "post", id: 21 },
  wp_instalar_plugin: { slug: "litespeed-cache" },
  wp_cambiar_plugin: { plugin: "akismet/akismet", estado: "active" },
  wp_eliminar_plugin: { plugin: "akismet/akismet" },
  wp_actualizar_ajustes: { ajustes: { title: "Panadería Aurora e Hijos" } },
  wp_moderar_comentario: { comentario_id: 100, estado: "approved" },
  wp_crear_termino: { taxonomia: "categories", nombre: "Recetas" },
  wp_subir_media: {
    url_archivo: `${BASE_DOBLE}/imagen.png`,
    nombre_archivo: "imagen.png",
  },
  wp_crear_usuario: { username: "ana", email: "ana@ejemplo.test", role: "editor" },
  wp_cambiar_rol_usuario: { usuario_id: 1, role: "editor" },
  wp_crear_pagina_elementor: {
    titulo: "Landing de temporada",
    secciones: [
      { tipo: "hero", titulo: "Pan de verdad", subtitulo: "Desde 1998", boton: "Pedir" },
      {
        tipo: "beneficios",
        items: [
          { titulo: "Masa madre", texto: "Fermentación de 24 horas", icono: "🥖" },
          { titulo: "Horno de leña", texto: "Como siempre se hizo", icono: "🔥" },
        ],
      },
      { tipo: "stats", items: [{ cifra: "27", etiqueta: "años" }] },
      {
        tipo: "testimonios",
        items: [{ texto: "El mejor del barrio", autor: "Marta", cargo: "vecina" }],
      },
      { tipo: "faq", titulo: "Dudas", items: [{ pregunta: "¿Repartís?", respuesta: "Sí." }] },
      { tipo: "texto", titulo: "Quiénes somos", html: "<p>Una familia.</p>" },
      { tipo: "cta", titulo: "¿Hablamos?", boton: "Escríbenos", boton_url: "/contacto/" },
    ],
  },
  wp_crear_header_global: {
    marca: "Aurora",
    enlaces: [
      { texto: "Inicio", url: "/" },
      { texto: "Historia", url: "/nuestra-historia/" },
      { texto: "Google", url: "https://www.google.com" },
    ],
    incluir_footer: true,
  },
  pedir_aprobacion: { propuesta: "Añadir al footer un enlace a https://www.google.com." },
  verificar_http: { path: "/nuestra-historia", contiene: "1998" },
  navegador_ver_pagina: { path: "/", pagina_completa: false },
  navegador_click: { texto: "Inicio" },
  navegador_escribir: { selector: "input", texto: "pan", enviar: false },
  navegador_leer: {},
  navegador_consola: {},
};

const SIN_PROBAR_AQUI = new Set([
  // Necesita el almacén de referencias de la plataforma, que no es del sitio.
  "ver_referencia",
]);

function montar() {
  const wp = crearDobleWordPress();
  const navegador = new NavegadorFalso(BASE_DOBLE, () => ({
    titulo: "Inicio",
    texto: "Pan de verdad",
    status: 200,
  }));
  const sitio: SitioContext = {
    siteId: "site_1",
    taskId: "task_barrido",
    tipo: "wp",
    wp: { url: BASE_DOBLE, user: wp.estado.usuario, appPassword: wp.estado.appPassword },
    backups: new BackupsEnMemoria(),
    // Todo aprobado: aquí se prueba que la herramienta FUNCIONA, no la puerta.
    approvals: {
      async check() {
        return "aprobada" as const;
      },
      async request() {
        return { id: "ap", decision: "aprobada" as const };
      },
    },
    browser: navegador,
    fetch: wp.fetch,
  };
  const ctx: ToolContext = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: [...SCOPES_WORDPRESS, ...SCOPES_CONECTOR],
    ports: {},
    now: () => new Date(),
    ...{ sitio },
  } as ToolContext;
  return { wp, ctx };
}

describe("barrido de herramientas de WordPress y navegador", () => {
  const aProbar = HERRAMIENTAS_WEBMASTER.filter(
    (t) => !t.slug.startsWith("conector_") && !SIN_PROBAR_AQUI.has(t.slug),
  );

  it("la lista del barrido cubre todas las herramientas no del conector", () => {
    const cubiertas = new Set(Object.keys(ENTRADAS_WP));
    const faltan = aProbar.map((t) => t.slug).filter((s) => !cubiertas.has(s));
    expect(faltan).toEqual([]);
  });

  for (const def of HERRAMIENTAS_WEBMASTER.filter(
    (t) => !t.slug.startsWith("conector_") && !SIN_PROBAR_AQUI.has(t.slug),
  )) {
    it(`${def.slug} responde contra el doble`, async () => {
      const { ctx } = montar();
      const salida = await executeToolDef(
        webmasterToolRegistry.get(def.slug),
        ctx,
        ENTRADAS_WP[def.slug] as never,
      );
      expect(salida, def.slug).toBeTypeOf("object");
      expect(salida, def.slug).not.toBeNull();
      // Ninguna debe devolver un bloqueo: aquí todo está aprobado.
      expect((salida as Record<string, unknown>).requiere_aprobacion, def.slug).toBeUndefined();
    });
  }

  it("las mutaciones dejan huella real en el sitio", async () => {
    const { wp, ctx } = montar();
    const llamar = (slug: string) =>
      executeToolDef(webmasterToolRegistry.get(slug), ctx, ENTRADAS_WP[slug] as never);

    await llamar("wp_editar_contenido");
    expect(wp.estado.contenido.find((c) => c.id === 7)?.titulo).toBe("Historia renovada");

    await llamar("wp_crear_contenido");
    expect(wp.estado.contenido.some((c) => c.titulo === "Novedades del horno")).toBe(true);

    await llamar("wp_actualizar_ajustes");
    expect(wp.estado.ajustes.title).toBe("Panadería Aurora e Hijos");

    await llamar("wp_moderar_comentario");
    expect(wp.estado.comentarios[0]?.status).toBe("approved");

    await llamar("wp_instalar_plugin");
    expect(wp.estado.plugins.some((p) => p.plugin.startsWith("litespeed-cache/"))).toBe(true);

    await llamar("wp_eliminar_plugin");
    expect(wp.estado.plugins.some((p) => p.plugin === "akismet/akismet")).toBe(false);

    // La página con Elementor guarda el diseño en el meta, que es lo único que
    // distingue una landing de verdad de un HTML pegado.
    const elementor = (await llamar("wp_crear_pagina_elementor")) as { id: number };
    const pagina = wp.estado.contenido.find((c) => c.id === elementor.id);
    const data = JSON.parse(String(pagina?.meta._elementor_data)) as unknown[];
    expect(data).toHaveLength(7);

    await llamar("wp_borrar_contenido");
    expect(wp.estado.contenido.find((c) => c.id === 21)?.status).toBe("trash");
    await llamar("wp_restaurar_contenido");
    expect(wp.estado.contenido.find((c) => c.id === 21)?.status).toBe("publish");
  });

  it("sin el plugin conector, Elementor falla con un mensaje que se entiende", async () => {
    const wp = crearDobleWordPress({ conectorInstalado: false });
    const sitio: SitioContext = {
      siteId: "s",
      taskId: "t",
      tipo: "wp",
      wp: { url: BASE_DOBLE, user: wp.estado.usuario, appPassword: wp.estado.appPassword },
      backups: new BackupsEnMemoria(),
      approvals: new AprobacionesEnMemoria(),
      fetch: wp.fetch,
    };
    const ctx = {
      workspaceId: "ws_1",
      dryRun: false,
      scopes: SCOPES_WORDPRESS,
      ports: {},
      now: () => new Date(),
      sitio,
    } as unknown as ToolContext;

    await expect(
      executeToolDef(
        webmasterToolRegistry.get("wp_crear_pagina_elementor"),
        ctx,
        ENTRADAS_WP.wp_crear_pagina_elementor as never,
      ),
    ).rejects.toThrow(/plugin conector/);
  });
});
