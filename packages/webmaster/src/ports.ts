/**
 * Puertos del Webmaster.
 *
 * Nada de esto habla con Postgres ni con Playwright directamente: son
 * interfaces que inyecta quien arranca el agente (el worker en producción, un
 * doble en los tests). Es también la frontera con las corrientes que trabajan
 * en paralelo: el esquema de `backups`, `approvals` y `tasks` lo escribe la
 * corriente de base de datos, y aquí solo aparece la forma que necesitamos.
 */

// ---------------------------------------------------------------------------
// Backups: sin esto, revertir no es un botón sino una llamada de soporte
// ---------------------------------------------------------------------------

export type BackupScope = string;

export type BackupRecord = {
  readonly id: string;
  readonly alcance: BackupScope;
  readonly snapshot: unknown;
  readonly creadoEn: string;
};

export interface BackupPort {
  /** Guarda el estado ANTERIOR a una mutación y devuelve su identificador. */
  create(input: {
    workspaceId: string;
    siteId: string;
    taskId: string;
    alcance: BackupScope;
    snapshot: unknown;
  }): Promise<string>;
  /** Recupera un backup para revertir. */
  read(input: { workspaceId: string; backupId: string }): Promise<BackupRecord | null>;
}

// ---------------------------------------------------------------------------
// Aprobación humana
// ---------------------------------------------------------------------------

export type ApprovalDecision = "aprobada" | "rechazada";

export type ApprovalRequest = {
  readonly id: string;
  readonly decision: ApprovalDecision | null;
};

/**
 * La herramienta sensible NO ejecuta: registra una solicitud y devuelve el
 * identificador. El trabajo queda suspendido hasta que una persona pulsa el
 * botón. `huella` es un hash de (herramienta + entrada): una aprobación vale
 * para EXACTAMENTE la acción que se aprobó, no para la siguiente parecida.
 */
export interface ApprovalPort {
  /** Decisión ya tomada para esta huella, si la hay. */
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

// ---------------------------------------------------------------------------
// Navegador: verificar de verdad, no que devolvió 200
// ---------------------------------------------------------------------------

export type CapturaPantalla = {
  /** JPEG en base64. Va a la evidencia de la tarea, no al historial del chat. */
  readonly base64: string;
  readonly mimeType: string;
  readonly url: string;
  readonly titulo: string;
};

/**
 * Sesión de navegador que vive toda la tarea, como un visitante real.
 * La implementación con Playwright está en `browser/playwright.ts` y es
 * opcional: si el worker no la monta, las herramientas `navegador_*` fallan
 * con un mensaje claro en vez de con un `undefined`.
 */
export interface BrowserPort {
  ir(path: string, paginaCompleta: boolean): Promise<CapturaPantalla & { status: number | null }>;
  click(objetivo: { texto?: string; selector?: string }): Promise<CapturaPantalla & { nota?: string }>;
  escribir(input: { selector: string; texto: string; enviar: boolean }): Promise<
    CapturaPantalla & { nota?: string }
  >;
  leer(selector?: string): Promise<{ url: string; texto: string }>;
  consola(): Promise<{ url: string; consola: readonly string[] }>;
  cerrar(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Referencias visuales adjuntadas por el cliente
// ---------------------------------------------------------------------------

/**
 * Dónde se acumulan las capturas de una ejecución. Va en el contexto del sitio
 * y no en una variable de módulo: dos tareas del mismo proceso no pueden
 * compartir evidencia.
 */
export type ColectorCapturas = {
  push(input: {
    herramienta: string;
    base64: string;
    mimeType: string;
    url: string;
    titulo: string;
  }): void;
};

export interface ReferencePort {
  /** Hosts desde los que se acepta descargar una referencia. Vacío = ninguno. */
  readonly hostsPermitidos: readonly string[];
  descargar(url: string): Promise<{ mimeType: string; bytes: Uint8Array }>;
}

// ---------------------------------------------------------------------------
// Contexto del sitio
// ---------------------------------------------------------------------------

export type WpCreds = {
  /** URL del sitio. Se admite con o sin esquema. */
  readonly url: string;
  readonly user: string;
  /** Contraseña de aplicación de WordPress. Nunca llega al modelo. */
  readonly appPassword: string;
};

export type ConectorCreds = {
  /** Base completa de la API, p. ej. https://misitio.com/api/oficinaia/v1 */
  readonly baseUrl: string;
  readonly token: string;
};

export type SitioContext = {
  readonly siteId: string;
  readonly taskId: string;
  readonly tipo: "wp" | "custom";
  readonly wp?: WpCreds;
  readonly conector?: ConectorCreds;
  readonly backups: BackupPort;
  readonly approvals: ApprovalPort;
  readonly browser?: BrowserPort;
  readonly referencias?: ReferencePort;
  /** Lo monta el bucle al empezar la tarea, para reunir la evidencia visual. */
  readonly capturas?: ColectorCapturas;
  /**
   * Salida HTTP. Inyectable para poder poner un doble de la REST API de
   * WordPress delante en los tests sin parchear el `fetch` global.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Primer contacto con este sitio: el agente explora y propone, no muta.
   * El worker lo activa mirando si ya hubo una tarea completada antes.
   */
  readonly primerContacto?: boolean;
};

export function requireWp(sitio: SitioContext, toolSlug: string): WpCreds {
  if (!sitio.wp) {
    throw new Error(
      `La herramienta "${toolSlug}" necesita un sitio WordPress conectado y este sitio es de tipo "${sitio.tipo}".`,
    );
  }
  return sitio.wp;
}

export function requireConector(sitio: SitioContext, toolSlug: string): ConectorCreds {
  if (!sitio.conector) {
    throw new Error(
      `La herramienta "${toolSlug}" necesita un sitio conectado por el conector estándar y este sitio es de tipo "${sitio.tipo}".`,
    );
  }
  return sitio.conector;
}

export function requireBrowser(sitio: SitioContext, toolSlug: string): BrowserPort {
  if (!sitio.browser) {
    throw new Error(
      `La herramienta "${toolSlug}" necesita un navegador y esta ejecución no lo tiene montado.`,
    );
  }
  return sitio.browser;
}
