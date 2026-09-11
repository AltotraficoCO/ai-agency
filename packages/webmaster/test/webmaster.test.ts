/**
 * Pruebas del Webmaster de extremo a extremo contra un doble de la REST API de
 * WordPress. Lo que se comprueba no es que el modelo elija bien —eso no lo
 * decide un test— sino que cuando el modelo pide algo, pasa exactamente lo que
 * la ficha del agente promete: se hace backup, se muta, se verifica, se puede
 * revertir, y lo sensible no se ejecuta sin un clic humano.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { RateTable } from "@strappy/core";
import {
  ejecutarTareaWebmaster,
  herramientasDe,
  huellaAccion,
  webmaster,
  type PasoTrabajo,
  type SitioContext,
} from "../src/index.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_DOBLE,
  crearDobleWordPress,
  modeloGuionizado,
  modeloQueNoResponde,
  NavegadorFalso,
  type DobleWordPress,
  type PasoGuion,
} from "../src/testing/index.js";

const TARIFAS: RateTable = {
  models: { "prueba/modelo": { input: 3, output: 15, cacheRead: 0.3 } },
  fallback: { input: 10, output: 50 },
};

type Montaje = {
  wp: DobleWordPress;
  backups: BackupsEnMemoria;
  aprobaciones: AprobacionesEnMemoria;
  navegador: NavegadorFalso;
  sitio: SitioContext;
};

function montar(o: { primerContacto?: boolean } = {}): Montaje {
  const wp = crearDobleWordPress();
  const backups = new BackupsEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const navegador = new NavegadorFalso(BASE_DOBLE, (ruta) => {
    const slug = ruta.replace(/^\/|\/$/g, "");
    const pagina =
      slug === ""
        ? wp.estado.contenido.find((c) => c.id === wp.estado.ajustes.page_on_front)
        : wp.estado.contenido.find((c) => c.slug === slug);
    return pagina
      ? { titulo: pagina.titulo, texto: `${pagina.titulo}\n${pagina.contenido}`, status: 200 }
      : { titulo: "No encontrado", texto: "404", status: 404 };
  });

  const sitio: SitioContext = {
    siteId: "site_1",
    taskId: "task_1",
    tipo: "wp",
    wp: {
      url: BASE_DOBLE,
      user: wp.estado.usuario,
      appPassword: wp.estado.appPassword,
    },
    backups,
    approvals: aprobaciones,
    browser: navegador,
    fetch: wp.fetch,
    ...(o.primerContacto ? { primerContacto: true } : {}),
  };
  return { wp, backups, aprobaciones, navegador, sitio };
}

function correr(m: Montaje, guion: readonly PasoGuion[], extra: { repetir?: boolean } = {}) {
  const { modelo, llamadas } = modeloGuionizado(guion, extra.repetir ?? false);
  return ejecutarTareaWebmaster({
    agent: webmaster,
    model: modelo,
    modelId: "prueba/modelo",
    rates: TARIFAS,
    workspaceId: "ws_1",
    agentName: "Max",
    sitio: m.sitio,
    tarea: {
      id: m.sitio.taskId,
      titulo: "Cambia el título de la página de nuestra historia",
      detalle: "Que diga «Nuestra historia desde 1998».",
    },
  }).then((r) => ({ resultado: r, llamadas }));
}

// ---------------------------------------------------------------------------

describe("extremo a extremo · cambiar el título de una página", () => {
  let m: Montaje;
  beforeEach(() => {
    m = montar();
  });

  it("explora, hace backup, muta, verifica y devuelve RESUMEN con backup_id", async () => {
    const { resultado, llamadas } = await correr(m, [
      { llama: "sitio_salud" },
      { llama: "wp_listar_contenido" },
      { llama: "wp_leer_contenido", con: { tipo: "page", id: 7 } },
      {
        llama: "wp_editar_contenido",
        con: { tipo: "page", id: 7, nuevo_titulo: "Nuestra historia desde 1998" },
      },
      { llama: "navegador_ver_pagina", con: { path: "/nuestra-historia" } },
      { llama: "navegador_leer" },
      {
        dice:
          "Cambié el título y lo comprobé en el navegador.\n" +
          "RESUMEN: la página «Nuestra historia» ahora se llama «Nuestra historia desde 1998». " +
          "Lo verifiqué abriendo /nuestra-historia. Backup: bk_1.",
      },
    ]);

    expect(resultado.estado).toBe("completada");
    if (resultado.estado !== "completada") return;

    // El sitio cambió de verdad.
    expect(m.wp.estado.contenido.find((c) => c.id === 7)?.titulo).toBe(
      "Nuestra historia desde 1998",
    );

    // Exploró antes de tocar: leyó la página antes de editarla.
    expect(llamadas.indexOf("wp_leer_contenido")).toBeLessThan(
      llamadas.indexOf("wp_editar_contenido"),
    );

    // Hay backup y viaja en el resultado de la herramienta.
    expect(m.backups.guardados).toHaveLength(1);
    expect(m.backups.guardados[0]?.snapshot).toMatchObject({ titulo: "Nuestra historia" });
    const edicion = resultado.evidencia.acciones.find((a) => a.herramienta === "wp_editar_contenido");
    expect((edicion?.salida as { backup_id?: string })?.backup_id).toBe("bk_1");
    expect(resultado.evidencia.backups).toEqual(["bk_1"]);

    // Verificó con el navegador, no solo con un 200.
    expect(m.navegador.visitadas).toContain("/nuestra-historia");
    expect(resultado.evidencia.capturas).toHaveLength(1);

    // Cerró con RESUMEN y el resumen es lo que se le entrega al cliente.
    expect(resultado.resumen.startsWith("la página «Nuestra historia»")).toBe(true);

    // Y el consumo quedó medido, que es la razón de haber sacado OpenCode.
    expect(resultado.evidencia.pasos).toBe(7);
    expect(resultado.evidencia.uso.outputTokens).toBeGreaterThan(0);
    expect(resultado.evidencia.creditos).toBeGreaterThan(0);
  });

  it("revertir con el backup deja el contenido como estaba", async () => {
    await correr(m, [
      {
        llama: "wp_editar_contenido",
        con: {
          tipo: "page",
          id: 7,
          nuevo_titulo: "Título equivocado",
          nuevo_contenido_html: "<p>Texto equivocado.</p>",
        },
      },
      { dice: "RESUMEN: cambié la página." },
    ]);
    expect(m.wp.estado.contenido.find((c) => c.id === 7)?.titulo).toBe("Título equivocado");

    const { resultado } = await correr(m, [
      { llama: "wp_restaurar_contenido", con: { tipo: "page", id: 7, backup_id: "bk_1" } },
      { dice: "RESUMEN: lo dejé como estaba." },
    ]);

    expect(resultado.estado).toBe("completada");
    const pagina = m.wp.estado.contenido.find((c) => c.id === 7);
    expect(pagina?.titulo).toBe("Nuestra historia");
    expect(pagina?.contenido).toBe("<p>Abrimos en 1998 en el barrio.</p>");
  });

  it("un backup de otra página no sirve para restaurar esta", async () => {
    const { resultado } = await correr(m, [
      { llama: "wp_editar_contenido", con: { tipo: "page", id: 7, nuevo_titulo: "Otro" } },
      { llama: "wp_restaurar_contenido", con: { tipo: "page", id: 2, backup_id: "bk_1" } },
      { dice: "RESUMEN: no pude." },
    ]);
    const intento = resultado.evidencia.acciones.find(
      (a) => a.herramienta === "wp_restaurar_contenido",
    );
    expect(intento?.error).toMatch(/es de page:7/);
    expect(m.wp.estado.contenido.find((c) => c.id === 2)?.titulo).toBe("Inicio");
  });
});

// ---------------------------------------------------------------------------

describe("aprobación humana", () => {
  it("no toca la página de precios sin un clic: crea la solicitud y no muta", async () => {
    const m = montar();
    const { resultado } = await correr(m, [
      { llama: "wp_leer_contenido", con: { tipo: "page", id: 11 } },
      {
        llama: "wp_editar_contenido",
        con: { tipo: "page", id: 11, nuevo_contenido_html: "<p>Suscripción semanal: 35 €</p>" },
      },
      { dice: "RESUMEN: dejé el cambio de precios esperando tu visto bueno." },
    ]);

    // El sitio NO cambió.
    expect(m.wp.estado.contenido.find((c) => c.id === 11)?.contenido).toBe(
      "<p>Suscripción semanal: 20 €</p>",
    );
    // No se hizo backup: no había nada que respaldar porque no se mutó.
    expect(m.backups.guardados).toHaveLength(0);
    // Sí hay una solicitud, con su motivo.
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
    expect(m.aprobaciones.solicitudes[0]?.motivo).toMatch(/precios/);
    // Y la tarea queda suspendida, no "completada".
    expect(resultado.estado).toBe("esperando_aprobacion");
    if (resultado.estado !== "esperando_aprobacion") return;
    expect(resultado.evidencia.aprobacionesPendientes).toHaveLength(1);
    expect(resultado.mensajes.length).toBeGreaterThan(0);
  });

  it("con el clic dado, la misma acción sí se ejecuta", async () => {
    const m = montar();
    const entrada = {
      tipo: "page",
      id: 11,
      nuevo_contenido_html: "<p>Suscripción semanal: 35 €</p>",
    };
    m.aprobaciones.decidir(
      huellaAccion("task_1", "wp_editar_contenido", entrada),
      "aprobada",
    );

    const { resultado } = await correr(m, [
      { llama: "wp_editar_contenido", con: entrada },
      { dice: "RESUMEN: subí el precio a 35 €." },
    ]);

    expect(resultado.estado).toBe("completada");
    expect(m.wp.estado.contenido.find((c) => c.id === 11)?.contenido).toBe(
      "<p>Suscripción semanal: 35 €</p>",
    );
    expect(m.backups.guardados).toHaveLength(1);
  });

  it("una aprobación no es un cheque en blanco: cambiar la entrada exige otro clic", async () => {
    const m = montar();
    const aprobado = { tipo: "page", id: 11, nuevo_contenido_html: "<p>35 €</p>" };
    m.aprobaciones.decidir(huellaAccion("task_1", "wp_editar_contenido", aprobado), "aprobada");

    const { resultado } = await correr(m, [
      // Casi lo mismo, pero no lo mismo.
      { llama: "wp_editar_contenido", con: { ...aprobado, nuevo_contenido_html: "<p>95 €</p>" } },
      { dice: "RESUMEN: quedó pendiente." },
    ]);

    expect(resultado.estado).toBe("esperando_aprobacion");
    expect(m.wp.estado.contenido.find((c) => c.id === 11)?.contenido).toBe(
      "<p>Suscripción semanal: 20 €</p>",
    );
  });

  it("reanudar tras el clic ejecuta la acción que había quedado pendiente", async () => {
    const m = montar();
    const entrada = {
      tipo: "page",
      id: 11,
      nuevo_contenido_html: "<p>Suscripción semanal: 35 €</p>",
    };

    // Primer intento: queda suspendido y se guarda la conversación.
    const primero = await correr(m, [
      { llama: "wp_editar_contenido", con: entrada },
      { dice: "RESUMEN: falta tu visto bueno." },
    ]);
    expect(primero.resultado.estado).toBe("esperando_aprobacion");
    if (primero.resultado.estado !== "esperando_aprobacion") return;

    // Alguien pulsa el botón.
    m.aprobaciones.decidir(huellaAccion("task_1", "wp_editar_contenido", entrada), "aprobada");

    // Segundo intento: se reanuda con la conversación guardada.
    const { modelo } = modeloGuionizado([
      { llama: "wp_editar_contenido", con: entrada },
      { dice: "RESUMEN: ya está, subí el precio a 35 €." },
    ]);
    const segundo = await ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Sube el precio", detalle: null },
      mensajesPrevios: primero.resultado.mensajes,
    });

    expect(segundo.estado).toBe("completada");
    expect(m.wp.estado.contenido.find((c) => c.id === 11)?.contenido).toBe(
      "<p>Suscripción semanal: 35 €</p>",
    );
    expect(m.backups.guardados).toHaveLength(1);
  });

  it("editar la portada también exige aprobación aunque su título sea inocente", async () => {
    const m = montar();
    await correr(m, [
      { llama: "wp_editar_contenido", con: { tipo: "page", id: 2, nuevo_titulo: "Bienvenidos" } },
      { dice: "RESUMEN: pendiente." },
    ]);
    expect(m.aprobaciones.solicitudes[0]?.motivo).toMatch(/portada/);
    expect(m.wp.estado.contenido.find((c) => c.id === 2)?.titulo).toBe("Inicio");
  });

  it("instalar un plugin no se ejecuta: el AI SDK lo corta antes de llamar a la herramienta", async () => {
    const m = montar();
    const antes = m.wp.estado.plugins.length;
    const { resultado } = await correr(m, [
      { llama: "wp_instalar_plugin", con: { slug: "litespeed-cache" } },
      { dice: "RESUMEN: pendiente." },
    ]);

    expect(m.wp.estado.plugins).toHaveLength(antes);
    expect(resultado.estado).toBe("esperando_aprobacion");
    expect(m.aprobaciones.solicitudes.map((s) => s.toolSlug)).toContain("wp_instalar_plugin");
    // Ninguna llamada de instalación llegó al sitio.
    expect(m.wp.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/plugins"))).toHaveLength(
      0,
    );
  });

  /** Lo mismo que hace la web al pulsar Aprobar: contestar las peticiones abiertas. */
  function respuestasAprobadas(mensajes: readonly unknown[]) {
    return mensajes
      .flatMap((msg) => {
        const contenido = (msg as { content?: unknown }).content;
        return Array.isArray(contenido) ? (contenido as { type?: string; approvalId?: string }[]) : [];
      })
      .filter((p) => p.type === "tool-approval-request" && p.approvalId)
      .map((p) => ({ type: "tool-approval-response" as const, approvalId: p.approvalId!, approved: true }));
  }

  it("aprobar la instalación y reanudar instala el plugin sin que el modelo lo vuelva a pedir", async () => {
    // El fallo real: el aviso de reanudación iba DETRÁS de la respuesta de
    // aprobación, el AI SDK la ignoraba y la tarea quedaba en espera sin botones.
    const m = montar();
    const entrada = { slug: "litespeed-cache" };
    const primero = await correr(m, [
      { llama: "wp_instalar_plugin", con: entrada },
      { dice: "RESUMEN: pendiente." },
    ]);
    expect(primero.resultado.estado).toBe("esperando_aprobacion");
    if (primero.resultado.estado !== "esperando_aprobacion") return;

    m.aprobaciones.decidir(huellaAccion("task_1", "wp_instalar_plugin", entrada), "aprobada");
    const { modelo, llamadas } = modeloGuionizado([{ dice: "RESUMEN: instalé litespeed-cache." }]);
    const segundo = await ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Instala un plugin de caché", detalle: null },
      mensajesPrevios: primero.resultado.mensajes,
      aprobaciones: respuestasAprobadas(primero.resultado.mensajes),
    });

    expect(segundo.estado).toBe("completada");
    expect(m.wp.estado.plugins.some((p) => p.plugin.startsWith("litespeed-cache/"))).toBe(true);
    expect(llamadas).not.toContain("wp_instalar_plugin");
  });

  it("si el modelo repite una acción ya aprobada, sigue solo en vez de esperar un clic imposible", async () => {
    const m = montar();
    const entrada = { slug: "litespeed-cache" };
    const primero = await correr(m, [
      { llama: "wp_instalar_plugin", con: entrada },
      { dice: "RESUMEN: pendiente." },
    ]);
    if (primero.resultado.estado !== "esperando_aprobacion") throw new Error("debía quedar en espera");
    m.aprobaciones.decidir(huellaAccion("task_1", "wp_instalar_plugin", entrada), "aprobada");

    // Se reanuda bien, y el modelo vuelve a pedir EXACTAMENTE la misma acción
    // (p. ej. para reintentarla). La huella ya está aprobada: nadie puede
    // pulsar un botón que no se pinta, así que el bucle sigue con esa decisión.
    const { modelo } = modeloGuionizado([
      { llama: "wp_instalar_plugin", con: entrada },
      { dice: "RESUMEN: instalado." },
    ]);
    const segundo = await ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Instala un plugin de caché", detalle: null },
      mensajesPrevios: primero.resultado.mensajes,
      aprobaciones: respuestasAprobadas(primero.resultado.mensajes),
    });

    // Si falla, que el mensaje diga por qué en vez de solo "fallida".
    expect(segundo.estado === "fallida" ? segundo.error : segundo.estado).toBe("completada");
    expect(segundo.evidencia.aprobacionesPendientes).toEqual([]);
    expect(m.wp.estado.plugins.some((p) => p.plugin.startsWith("litespeed-cache/"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("modo de simulación en el primer contacto", () => {
  it("explora de verdad pero no muta nada", async () => {
    const m = montar({ primerContacto: true });
    const { resultado } = await correr(m, [
      { llama: "wp_listar_contenido" },
      { llama: "wp_leer_contenido", con: { tipo: "page", id: 7 } },
      {
        llama: "wp_editar_contenido",
        con: { tipo: "page", id: 7, nuevo_titulo: "Nuestra historia desde 1998" },
      },
      { dice: "RESUMEN: este es el plan que propongo." },
    ]);

    expect(resultado.estado).toBe("completada");
    if (resultado.estado !== "completada") return;
    expect(resultado.evidencia.simulacion).toBe(true);

    // La lectura fue real; la escritura, no.
    const lectura = resultado.evidencia.acciones.find((a) => a.herramienta === "wp_leer_contenido");
    const escritura = resultado.evidencia.acciones.find(
      (a) => a.herramienta === "wp_editar_contenido",
    );
    expect(lectura?.simulada).toBe(false);
    expect(escritura?.simulada).toBe(true);
    expect(m.wp.estado.contenido.find((c) => c.id === 7)?.titulo).toBe("Nuestra historia");
    expect(m.backups.guardados).toHaveLength(0);
    // En simulación no se molesta a nadie con un botón.
    expect(m.aprobaciones.solicitudes).toHaveLength(0);
  });

  it("el prompt le dice explícitamente que hoy no cambia nada", () => {
    const texto = webmaster.prompt({
      agentName: "Max",
      siteUrl: BASE_DOBLE,
      modoSimulacion: true,
    });
    expect(texto).toContain("MODO SIMULACIÓN");
    expect(texto).toContain("NO vas a cambiar nada");
  });
});

// ---------------------------------------------------------------------------

describe("límites duros", () => {
  it("se detiene en el tope de acciones del catálogo", async () => {
    const m = montar();
    const { resultado, llamadas } = await correr(
      m,
      [{ llama: "wp_listar_contenido" }],
      { repetir: true },
    );

    expect(webmaster.maxAcciones).toBe(25);
    expect(resultado.evidencia.pasos).toBe(25);
    expect(llamadas).toHaveLength(25);
    expect(resultado.evidencia.acciones).toHaveLength(25);
  });

  it("el timeout duro corta la tarea y lo reporta como tal", async () => {
    const m = montar();
    const resultado = await ejecutarTareaWebmaster({
      // Un agente igual al del catálogo pero con un tope de tiempo de test.
      agent: { ...webmaster, timeoutMs: 60 },
      model: modeloQueNoResponde(),
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Algo largo", detalle: null },
    });

    expect(resultado.estado).toBe("fallida");
    if (resultado.estado !== "fallida") return;
    expect(resultado.motivo).toBe("timeout");
    expect(m.wp.llamadas.filter((l) => l.metodo !== "GET")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("freno de repeticiones", () => {
  const SECCION = [{ tipo: "texto", titulo: "Por qué importa", html: "<p>La IA.</p>" }];

  function ejecutar(m: Montaje, modelo: ReturnType<typeof modeloGuionizado>["modelo"], vistos: PasoTrabajo[]) {
    return ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Diseña el post sobre IA con Elementor", detalle: null },
      alAvanzar: (paso) => vistos.push(paso),
    });
  }

  it("el mismo fallo tres veces termina la tarea como fallida, con el motivo y sin más llamadas", async () => {
    const m = montar();
    const vistos: PasoTrabajo[] = [];
    const { modelo, llamadas } = modeloGuionizado(
      [{ llama: "wp_crear_pagina_elementor", con: { titulo: "La IA", pagina_id: 999, secciones: SECCION } }],
      true,
    );

    const resultado = await ejecutar(m, modelo, vistos);

    expect(resultado.estado).toBe("fallida");
    if (resultado.estado !== "fallida") return;
    expect(resultado.error).toMatch(/^Me detuve porque «Diseñando con Elementor» falló 3 veces/);
    expect(resultado.error).toContain("no existe como página ni como entrada");
    // Tres intentos y ni uno más: sin el freno llegaba al tope de 25.
    expect(llamadas).toHaveLength(3);
    expect(modelo.doGenerateCalls).toHaveLength(3);
    expect(resultado.evidencia.acciones).toHaveLength(3);
    expect(m.wp.llamadas.filter((l) => l.metodo !== "GET")).toHaveLength(0);

    // Al segundo fallo el modelo ya leyó que no debía repetirlo.
    expect(JSON.stringify(modelo.doGenerateCalls[1]?.prompt)).not.toContain("Ya intentaste exactamente esto");
    expect(JSON.stringify(modelo.doGenerateCalls[2]?.prompt)).toContain(
      "Ya intentaste exactamente esto y falló 2 veces con: El id 999 no existe",
    );

    // El registro cuenta los tres intentos, cada uno con el error real de WordPress.
    const errores = vistos.filter((p) => p.estado === "error");
    expect(errores).toHaveLength(3);
    expect(new Set(errores.map((p) => p.id)).size).toBe(3);
    for (const p of errores) expect(p.detalle).toMatch(/^El id 999 no existe/);
  });

  it("cambiar de enfoque tras el aviso no frena: la tarea termina bien", async () => {
    const m = montar();
    const vistos: PasoTrabajo[] = [];
    const comoPagina = { titulo: "La IA", tipo: "page", pagina_id: 21, secciones: SECCION };
    const { modelo } = modeloGuionizado([
      { llama: "wp_crear_pagina_elementor", con: comoPagina },
      { llama: "wp_crear_pagina_elementor", con: comoPagina },
      { llama: "wp_crear_pagina_elementor", con: { ...comoPagina, tipo: "post" } },
      { dice: "RESUMEN: diseñé la entrada con Elementor." },
    ]);

    const resultado = await ejecutar(m, modelo, vistos);

    expect(resultado.estado).toBe("completada");
    const [primero, segundo, tercero] = resultado.evidencia.acciones;
    expect(primero?.error).toBe('El id 21 es una entrada (post), no una página: vuelve a llamar con tipo="post".');
    expect(segundo?.error).toBeDefined();
    expect(tercero?.error).toBeUndefined();
    const entrada = m.wp.estado.contenido.find((c) => c.id === 21);
    expect(JSON.parse(String(entrada?.meta._elementor_data))).toHaveLength(1);
    expect(vistos.filter((p) => p.estado === "hecho").at(-1)?.etiqueta).toBe(
      "Diseñando una entrada con Elementor",
    );
  });
});

// ---------------------------------------------------------------------------

describe("seguridad", () => {
  it("la contraseña de aplicación nunca sale en el resumen", async () => {
    const m = montar();
    const { resultado } = await correr(m, [
      { dice: `RESUMEN: la clave era ${m.wp.estado.appPassword} y la conté sin querer.` },
    ]);
    expect(resultado.estado).toBe("completada");
    if (resultado.estado !== "completada") return;
    expect(resultado.resumen).not.toContain(m.wp.estado.appPassword);
    expect(resultado.resumen).toContain("«oculto»");
  });

  it("el sitio se rechaza si las credenciales no valen", async () => {
    const m = montar();
    const sitio: SitioContext = {
      ...m.sitio,
      wp: { ...m.sitio.wp!, appPassword: "clave-que-no-es" },
    };
    const { modelo } = modeloGuionizado([
      { llama: "wp_leer_contenido", con: { tipo: "page", id: 7 } },
      { dice: "RESUMEN: no pude entrar." },
    ]);
    const resultado = await ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio,
      tarea: { id: "task_1", titulo: "Leer", detalle: null },
    });
    const lectura = resultado.evidencia.acciones[0];
    expect(lectura?.error).toMatch(/401/);
  });

  it("el agente solo ve las herramientas que su ficha permite", async () => {
    const m = montar();
    const { resultado } = await correr(m, [
      { llama: "conector_listar_paginas" },
      { dice: "RESUMEN: nada." },
    ]);
    // La herramienta del conector no está montada para este agente: el modelo
    // recibe un error de herramienta desconocida y nunca llega a ejecutarse.
    expect(resultado.evidencia.acciones.map((a) => a.herramienta)).not.toContain(
      "conector_listar_paginas",
    );
    expect(m.wp.llamadas.filter((l) => l.metodo !== "GET")).toHaveLength(0);
    // Y la ficha del agente, que es lo que decide, no la incluye.
    expect(herramientasDe(webmaster).map((t) => t.slug)).not.toContain("conector_listar_paginas");
    expect(herramientasDe(webmaster).map((t) => t.slug)).toContain("wp_editar_contenido");
  });
});

describe("registro de trabajo en vivo", () => {
  it("avisa al empezar y al terminar cada herramienta y deja esperando lo que pide aprobación", async () => {
    const m = montar();
    const vistos: PasoTrabajo[] = [];
    const { modelo } = modeloGuionizado([
      { llama: "wp_leer_contenido", con: { tipo: "page", id: 7 } },
      { llama: "wp_instalar_plugin", con: { slug: "litespeed-cache" } },
      { dice: "RESUMEN: pendiente." },
    ]);
    const resultado = await ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Instala un plugin de caché", detalle: null },
      alAvanzar: (paso) => vistos.push(paso),
    });

    expect(resultado.estado).toBe("esperando_aprobacion");
    const leer = vistos.filter((p) => p.herramienta === "wp_leer_contenido");
    expect(leer.map((p) => p.estado)).toEqual(["en_curso", "hecho"]);
    // El mismo id empieza y termina: la web lo fusiona en una sola fila.
    expect(new Set(leer.map((p) => p.id)).size).toBe(1);
    expect(leer[0]?.etiqueta).toBe("Leyendo una página");

    const instalar = vistos.filter((p) => p.herramienta === "wp_instalar_plugin");
    expect(instalar.at(-1)).toMatchObject({ estado: "esperando", detalle: "litespeed-cache" });
    // Nada del registro lleva la contraseña de aplicación del sitio.
    expect(JSON.stringify(vistos)).not.toContain(m.wp.estado.appPassword);
  });

  it("un fallo de quien escucha no para el trabajo", async () => {
    const m = montar();
    const { modelo } = modeloGuionizado([
      { llama: "wp_listar_contenido" },
      { dice: "RESUMEN: revisé el contenido." },
    ]);
    const resultado = await ejecutarTareaWebmaster({
      agent: webmaster,
      model: modelo,
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_1", titulo: "Revisa el contenido", detalle: null },
      alAvanzar: () => {
        throw new Error("la base se cayó");
      },
    });
    expect(resultado.estado).toBe("completada");
  });
});
