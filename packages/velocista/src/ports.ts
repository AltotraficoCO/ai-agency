/**
 * Puertos del Velocista.
 *
 * Aquí no hay ni una llamada HTTP: son las interfaces que el worker rellena
 * (PageSpeed Insights, la REST API de WordPress) y que los tests rellenan con
 * dobles. La misma frontera que en Marketing y en el financiero, y por la misma
 * razón: el agente entero se puede probar sin clave de Google y sin un
 * WordPress delante.
 *
 * Una decisión que manda sobre todo lo demás: **las mediciones traen de dónde
 * salen**. No es un detalle técnico, es honestidad con el cliente. Lo que mide
 * una prueba de laboratorio («abrí tu página desde un servidor con conexión
 * simulada») y lo que le pasa a la gente que entra desde su celular en Medellín
 * no son lo mismo, y cuando no coinciden, la que manda es la de la gente real.
 * Por eso `campo` y `laboratorio` viajan separados y nunca se mezclan en una
 * sola cifra.
 *
 * Los puertos de aprobación y backup se declaran con la misma forma que los del
 * Webmaster a propósito: TypeScript es estructural, así que los adaptadores que
 * el worker ya tiene encajan sin que este paquete dependa de aquel.
 */

/** Cómo entra la gente. Se mide siempre primero en móvil: es donde duele. */
export type Dispositivo = "movil" | "escritorio";

export const NOMBRE_DISPOSITIVO: Readonly<Record<Dispositivo, string>> = {
  movil: "celular",
  escritorio: "computador",
};

/**
 * Las tres métricas que Google usa para decidir si una página es rápida
 * (vigentes en septiembre de 2026).
 *
 *  · `lcp`: milisegundos hasta que se ve lo importante de la página.
 *  · `inp`: milisegundos que tarda en responder cuando alguien toca algo.
 *  · `cls`: cuánto se mueve la página sola mientras carga (sin unidad).
 *
 * `inp` solo existe cuando hay usuarios reales: no se puede medir en una
 * prueba de laboratorio, porque nadie hace clic en una prueba. Por eso es
 * opcional, y el agente tiene prohibido inventarlo.
 */
export type Vitales = {
  readonly lcp?: number;
  readonly inp?: number;
  readonly cls?: number;
};

/**
 * Lo que mide una prueba de laboratorio, además de los vitales.
 *
 * `tbt` (tiempo bloqueado) es lo más parecido a `inp` que se puede medir sin
 * usuarios: no es lo mismo y no se presenta como tal.
 */
export type Laboratorio = Vitales & {
  /** Milisegundos con el navegador bloqueado sin poder responder. */
  readonly tbt?: number;
  /** Milisegundos hasta el primer byte: lo que tarda el servidor en contestar. */
  readonly ttfb?: number;
  /** 0..100 tal cual lo da la herramienta. Orientativo: no se le enseña al cliente como nota. */
  readonly puntuacion?: number;
};

/** Lo que le pasa a la gente de verdad, al percentil 75 (así lo evalúa Google). */
export type Campo = Vitales & {
  /** Cuántos días de datos reales respaldan esto, si la fuente lo dice. */
  readonly dias?: number;
};

/** Algo concreto que está frenando la página, tal como lo reporta la medición. */
export type Freno = {
  /** Identificador de la fuente (`unused-javascript`, `uses-optimized-images`…). */
  readonly clave: string;
  /** Cómo lo llama la fuente. Se traduce antes de enseñárselo al cliente. */
  readonly titulo: string;
  /** Milisegundos que se ganarían si se arreglara, si la fuente lo estima. */
  readonly ahorroMs?: number;
  /** Bytes que se dejarían de descargar, si la fuente lo estima. */
  readonly ahorroBytes?: number;
};

export type Medicion = {
  readonly url: string;
  readonly dispositivo: Dispositivo;
  /** ISO 8601. */
  readonly medidoEn: string;
  readonly laboratorio: Laboratorio;
  /** Solo si la página tiene tráfico suficiente para que Google publique datos. */
  readonly campo?: Campo;
  readonly frenos: readonly Freno[];
};

/**
 * Quien sabe medir. En producción, PageSpeed Insights; en los tests, un doble.
 *
 * `disponible` es false cuando no hay clave configurada: el agente entonces
 * mide con el navegador propio si lo tiene, y si tampoco, lo dice en vez de
 * fallar con un error técnico.
 */
export interface RendimientoPort {
  readonly fuente: string;
  readonly disponible: boolean;
  medir(input: { url: string; dispositivo: Dispositivo }): Promise<Medicion>;
}

// ---------------------------------------------------------------------------
// El sitio: lo mínimo para diagnosticar y para arreglar lo que se puede
// ---------------------------------------------------------------------------

export type ImagenSitio = {
  readonly id: number;
  readonly url: string;
  readonly titulo: string;
  /** Bytes del archivo. Undefined si el sitio no lo publica. */
  readonly bytes?: number;
  /** `image/jpeg`, `image/webp`… */
  readonly mime?: string;
  readonly ancho?: number;
  readonly alto?: number;
};

export type PluginSitio = {
  readonly slug: string;
  readonly nombre: string;
  readonly activo: boolean;
};

export type ResultadoPlugin = {
  readonly slug: string;
  readonly nombre: string;
  readonly activo: boolean;
  /** true si ya estaba instalado y solo se activó. */
  readonly yaEstaba: boolean;
};

/**
 * El sitio del cliente, visto por el Velocista.
 *
 * Es deliberadamente pequeño: este agente no edita páginas ni escribe
 * contenido. Para eso está el Webmaster, y puede pedirle ayuda. Lo único que
 * escribe por su cuenta es activar la caché, porque es el arreglo que más
 * cambia el tiempo de carga y el que ningún dueño de negocio va a hacer solo.
 */
export interface SitioPort {
  readonly url: string;
  /** false cuando la conexión solo permite leer: se analiza y se propone igual. */
  readonly puedeEscribir: boolean;
  paginas(): Promise<readonly { url: string; titulo: string }[]>;
  medios(): Promise<readonly ImagenSitio[]>;
  plugins(): Promise<readonly PluginSitio[]>;
  /** Instala (si hace falta) y activa un plugin. Solo tras aprobación humana. */
  instalarPlugin(input: { slug: string }): Promise<ResultadoPlugin>;
}

// ---------------------------------------------------------------------------
// Aprobación humana y backups (misma forma que en el Webmaster, a propósito)
// ---------------------------------------------------------------------------

export type ApprovalDecision = "aprobada" | "rechazada";

export type ApprovalRequest = {
  readonly id: string;
  readonly decision: ApprovalDecision | null;
};

export interface ApprovalPort {
  check(input: {
    workspaceId: string;
    taskId: string;
    huella: string;
  }): Promise<ApprovalDecision | null>;
  request(input: {
    workspaceId: string;
    taskId: string;
    siteId: string;
    huella: string;
    toolSlug: string;
    motivo: string;
    resumen: string;
    entrada: unknown;
  }): Promise<ApprovalRequest>;
}

export interface BackupPort {
  create(input: {
    workspaceId: string;
    siteId: string;
    taskId: string;
    alcance: string;
    snapshot: unknown;
  }): Promise<string>;
  read(input: { workspaceId: string; backupId: string }): Promise<{
    readonly id: string;
    readonly alcance: string;
    readonly snapshot: unknown;
    readonly creadoEn: string;
  } | null>;
}

// ---------------------------------------------------------------------------
// Contexto de trabajo
// ---------------------------------------------------------------------------

/**
 * Lo que el runtime inyecta en cada ejecución. NADA de esto puede venir del
 * modelo: si el modelo pudiera elegir el sitio, una inyección de prompt sería
 * instalar plugins en la web de otro cliente.
 */
export type VelocidadContext = {
  /** Id de la conexión del encargo: sobre ella cuelgan aprobaciones y backups. */
  readonly conexionId: string;
  readonly taskId: string;
  /** Sin sitio conectado el agente lo dice; no revienta. */
  readonly sitio?: SitioPort;
  /** Sin medidor, el agente lo dice: medir a ojo no es medir. */
  readonly rendimiento?: RendimientoPort;
  readonly approvals: ApprovalPort;
  readonly backups?: BackupPort;
  /**
   * Primer contacto: mira y propone, no toca nada. El primer día con el sitio
   * de un cliente no puede ser también el primero en que le instalamos algo.
   */
  readonly primerContacto?: boolean;
  /**
   * Mediciones de esta misma tarea, para poder enseñar el antes y el después.
   * Lo rellena el propio agente al medir; no viene del modelo.
   */
  readonly historial: Medicion[];
};

export function requireSitio(ctx: VelocidadContext, toolSlug: string): SitioPort {
  if (!ctx.sitio) {
    throw new Error(
      `"${toolSlug}" necesita el sitio del cliente conectado y este espacio no lo tiene. ` +
        `Díselo al cliente: sin conexión puedo medir su página, pero no revisar sus imágenes ni sus plugins.`,
    );
  }
  return ctx.sitio;
}

export function requireRendimiento(ctx: VelocidadContext, toolSlug: string): RendimientoPort {
  if (!ctx.rendimiento || !ctx.rendimiento.disponible) {
    throw new Error(
      `"${toolSlug}" no tiene con qué medir la velocidad ahora mismo. ` +
        `Dilo en el RESUMEN: sin medición no se opina de velocidad, se inventa.`,
    );
  }
  return ctx.rendimiento;
}
