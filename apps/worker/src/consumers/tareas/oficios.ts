/**
 * Cada oficio: cargar lo suyo y lanzarlo. Lo demás ya es común.
 */
import type { EntradaComunDeAgente, ResultadoTarea } from "@strappy/agentes";
import {
  agentePara,
  ejecutarTareaWebmaster,
  type BrowserPort,
  type ConectorCreds,
  type ReferencePort,
  type RepoCreds,
  type SitioContext,
  type WpCreds,
} from "@strappy/webmaster";
import { ejecutarTareaMarketing, marketing, type CuentasContext } from "@strappy/marketing";
import {
  AGENTES as AGENTES_ADMINISTRATIVOS,
  ejecutarTareaAdministrativa,
  type LibrosContext,
} from "@strappy/administrativo";
import {
  disenador,
  ejecutarTareaDisenador,
  type DisenoContext,
} from "@strappy/disenador";
import type { Medicion, VelocidadContext } from "@strappy/velocista";
import type {
  CuentasDeMarketing,
  EstudioDeDiseno,
  LibrosDelNegocio,
  PuertosWorker,
  SitioConectado,
  VelocidadDelSitio,
} from "../../ports.js";
import { normalizarSlug, oficioDesconocido, type Encargo } from "./encargo.js";

/** Lo que el consumidor le presta a cada oficio para lanzarlo. */
export type EntornoDeOficio = {
  readonly puertos: PuertosWorker;
  /** Lo que toda llamada a un bucle de agente lleva igual. */
  readonly comun: (e: Encargo, slug: string, agentName: string) => Promise<EntradaComunDeAgente>;
  readonly abrirNavegador: (sitio: SitioConectado, decir: (m: string) => void) => Promise<BrowserPort | null>;
  readonly referencias?: ReferencePort;
  readonly fetchSitio?: typeof globalThis.fetch;
};

const SITIO_SIN_CONECTAR =
  "El sitio no está conectado. El cliente debe conectarlo antes de que pueda trabajar en él.";

export async function ejecutarWebmaster(e: Encargo, entorno: EntornoDeOficio): Promise<ResultadoTarea> {
  const { tarea, motor, decir } = e;
  const { puertos } = entorno;
  if (!tarea.siteId) throw new Error(SITIO_SIN_CONECTAR);
  const sitio = await puertos.sitios.cargar({
    workspaceId: tarea.workspaceId,
    siteId: tarea.siteId,
  });
  if (!sitio) throw new Error(SITIO_SIN_CONECTAR);

  const agent = agentePara(sitio.tipo);
  decir(
    `"${tarea.titulo}" → ${agent.slug} @ ${sitio.url} · ${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
      (sitio.primerContacto ? " (simulación)" : ""),
  );

  // La velocidad va dentro del Webmaster: medidor de PageSpeed, historial
  // de mediciones de ESTE encargo y lo necesario para activar la caché.
  const velocidad: VelocidadDelSitio | null = puertos.velocidad
    ? await puertos.velocidad.cargar({ workspaceId: tarea.workspaceId, conexionId: tarea.siteId })
    : null;
  const historial: Medicion[] = [];
  const contextoVelocidad: VelocidadContext | null = velocidad
    ? {
        conexionId: velocidad.conexionId ?? "",
        taskId: tarea.id,
        ...(velocidad.sitio ? { sitio: velocidad.sitio } : {}),
        ...(velocidad.rendimiento ? { rendimiento: velocidad.rendimiento } : {}),
        approvals: puertos.aprobaciones,
        ...(velocidad.conexionId ? { backups: puertos.backups } : {}),
        ...(sitio.primerContacto ? { primerContacto: true } : {}),
        historial,
      }
    : null;

  const navegador = await entorno.abrirNavegador(sitio, decir);
  const contextoSitio: SitioContext = {
    siteId: sitio.id,
    taskId: tarea.id,
    tipo: sitio.tipo,
    ...(sitio.tipo === "repo"
      ? { repo: sitio.credenciales as RepoCreds, ...(puertos.repoEstado ? { repoEstado: puertos.repoEstado } : {}) }
      : sitio.tipo === "custom"
        ? { conector: sitio.credenciales as ConectorCreds }
        : { wp: sitio.credenciales as WpCreds }),
    backups: puertos.backups,
    approvals: puertos.aprobaciones,
    ...(navegador ? { browser: navegador } : {}),
    ...(entorno.referencias ? { referencias: entorno.referencias } : {}),
    ...(entorno.fetchSitio ? { fetch: entorno.fetchSitio } : {}),
    primerContacto: sitio.primerContacto,
  };

  const resultado = await ejecutarTareaWebmaster({
    ...(await entorno.comun(e, "webmaster", sitio.agentName)),
    agent,
    sitio: contextoSitio,
    ...(contextoVelocidad ? { velocidad: contextoVelocidad } : {}),
    ...(velocidad?.secretos ? { secretos: velocidad.secretos } : {}),
  });

  // Con simulación no se tocó el sitio, así que sigue siendo primer
  // contacto: el próximo encargo ejecuta de verdad solo si esta vez se
  // ejecutó de verdad.
  if (!resultado.evidencia.simulacion && resultado.estado !== "fallida") {
    await puertos.sitios.marcarTocado({ workspaceId: tarea.workspaceId, siteId: sitio.id });
  }
  return resultado;
}

export async function ejecutarMarketing(e: Encargo, entorno: EntornoDeOficio): Promise<ResultadoTarea> {
  const { tarea, motor, decir } = e;
  const { puertos } = entorno;
  const cuentas: CuentasDeMarketing = puertos.cuentas
    ? await puertos.cuentas.cargar({
        workspaceId: tarea.workspaceId,
        conexionId: tarea.siteId,
      })
    : {
        conexionId: tarea.siteId,
        ads: [],
        negocio: "tu negocio",
        agentName: marketing.label,
      };

  decir(
    `"${tarea.titulo}" → ${marketing.slug} · ${cuentas.ads.length} plataforma(s) · ` +
      `${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
      (cuentas.primerContacto ? " (simulación)" : ""),
  );

  const contexto: CuentasContext = {
    conexionId: cuentas.conexionId ?? "",
    taskId: tarea.id,
    ads: cuentas.ads,
    ...(cuentas.analytics ? { analytics: cuentas.analytics } : {}),
    approvals: puertos.aprobaciones,
    // El backup solo tiene dónde colgarse si hay conexión: sin ella no hay
    // nada que revertir todavía.
    ...(cuentas.conexionId ? { backups: puertos.backups } : {}),
    ...(cuentas.primerContacto ? { primerContacto: true } : {}),
  };

  return ejecutarTareaMarketing({
    ...(await entorno.comun(e, "marketing", cuentas.agentName)),
    agent: marketing,
    negocio: cuentas.negocio,
    cuentas: contexto,
    ...(cuentas.secretos ? { secretos: cuentas.secretos } : {}),
  });
}

/**
 * El compañero más pedido de la oficina.
 *
 * Dos cosas propias suyas: el estudio se arma con el MODO de la tarea (el
 * modelo de imagen sale de `model_tiers`, fila `imagen`, igual que el de
 * texto sale de `negocio`), y su conexión es el sitio del cliente, que es
 * donde acaban las imágenes que publica.
 */
export async function ejecutarDisenador(e: Encargo, entorno: EntornoDeOficio): Promise<ResultadoTarea> {
  const { tarea, motor, decir } = e;
  const { puertos } = entorno;
  const estudio: EstudioDeDiseno = puertos.estudio
    ? await puertos.estudio.cargar({
        workspaceId: tarea.workspaceId,
        siteId: tarea.siteId,
        taskId: tarea.id,
        modo: motor.modo ?? "lite",
      })
    : {
        conexionId: tarea.siteId,
        negocio: "tu negocio",
        agentName: disenador.label,
      };

  decir(
    `"${tarea.titulo}" → ${disenador.slug} · ` +
      `${estudio.imagenes ? estudio.imagenes.modelo : "sin generador de imágenes"} · ` +
      `${estudio.medios ? estudio.medios.sitio : "sin sitio donde publicar"}` +
      (estudio.estilo ? " · con los colores del sitio" : " · sin colores medidos") +
      (estudio.primerContacto ? " (simulación)" : ""),
  );

  const contexto: DisenoContext = {
    conexionId: estudio.conexionId ?? "",
    taskId: tarea.id,
    ...(estudio.imagenes ? { imagenes: estudio.imagenes } : {}),
    ...(estudio.creditosPorImagen != null
      ? { creditosPorImagen: estudio.creditosPorImagen }
      : {}),
    ...(estudio.medios ? { medios: estudio.medios } : {}),
    ...(estudio.estilo ? { estilo: estudio.estilo } : {}),
    approvals: puertos.aprobaciones,
    ...(estudio.primerContacto ? { primerContacto: true } : {}),
  };

  return ejecutarTareaDisenador({
    ...(await entorno.comun(e, "disenador", estudio.agentName)),
    agent: disenador,
    negocio: estudio.negocio,
    diseno: contexto,
  });
}

export async function ejecutarAdministrativo(
  e: Encargo,
  quien: string,
  entorno: EntornoDeOficio,
): Promise<ResultadoTarea> {
  const { tarea, motor, decir } = e;
  const { puertos } = entorno;
  // El oficio decide qué herramientas tiene: Reportes no lleva las que
  // escriben, así que no puede emitir nada aunque se lo pidan.
  // Sin respaldo a `administrativo`: era una red que dependia de quien
  // llamara. Hoy el enrutado solo manda aqui dos slugs, pero un tercero
  // acabaria emitiendo facturas con el oficio equivocado en vez de fallar.
  const oficio = AGENTES_ADMINISTRATIVOS[normalizarSlug(quien)];
  if (!oficio) return oficioDesconocido(quien, e);
  const libros: LibrosDelNegocio = puertos.libros
    ? await puertos.libros.cargar({
        workspaceId: tarea.workspaceId,
        conexionId: tarea.siteId,
      })
    : {
        conexionId: tarea.siteId,
        negocio: "tu negocio",
        agentName: oficio.label,
      };

  decir(
    `"${tarea.titulo}" → ${oficio.slug} · ` +
      `${libros.contabilidad ? libros.contabilidad.sistema : "sin contabilidad conectada"}${libros.alegra ? " + Alegra completo" : ""} · ` +
      `${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
      (libros.primerContacto ? " (simulación)" : ""),
  );

  const contexto: LibrosContext = {
    conexionId: libros.conexionId ?? "",
    taskId: tarea.id,
    ...(libros.contabilidad ? { contabilidad: libros.contabilidad } : {}),
    ...(libros.alegra ? { alegra: libros.alegra } : {}),
    approvals: puertos.aprobaciones,
    // El backup solo tiene dónde colgarse si hay conexión: sin ella no hay
    // nada que revertir todavía.
    ...(libros.conexionId ? { backups: puertos.backups } : {}),
    ...(libros.primerContacto ? { primerContacto: true } : {}),
  };

  return ejecutarTareaAdministrativa({
    ...(await entorno.comun(e, oficio.slug, libros.agentName)),
    agent: oficio,
    negocio: libros.negocio,
    libros: contexto,
    ...(libros.secretos ? { secretos: libros.secretos } : {}),
  });
}
