/**
 * Puertos del agente Diseñador.
 *
 * Aquí no hay ni una llamada HTTP: son las interfaces que el worker rellena con
 * adaptadores reales (la cartera de modelos para generar, la biblioteca del
 * sitio para publicar) y que los tests rellenan con dobles. Por eso el agente
 * se puede probar entero sin gastar un solo crédito en un modelo de imagen.
 *
 * Dos decisiones que no son de estilo:
 *
 *  · **El estilo de la marca llega como DATO, no como una llamada a WordPress.**
 *    Quien sabe leer los colores y las tipografías reales de un sitio es el
 *    Webmaster (`sitio_leer_diseno`), y este paquete no depende de aquel: el
 *    worker traduce lo que el Webmaster midió a la forma de aquí. Así el
 *    Diseñador también sirve para un cliente sin WordPress.
 *
 *  · **La imagen viaja en base64 y nunca por una URL temporal.** No tenemos
 *    almacenamiento público propio, y publicar una imagen en un sitio ajeno
 *    pasándole una URL que caduca es la clase de detalle que funciona en la
 *    demo y falla en producción.
 */

// ---------------------------------------------------------------------------
// Generar
// ---------------------------------------------------------------------------

export type Medida = {
  readonly ancho: number;
  readonly alto: number;
};

export type ImagenGenerada = {
  /** Los bytes, en base64 y sin prefijo `data:`. */
  readonly base64: string;
  readonly mimeType: string;
  /** Identificador del modelo que la hizo. Para auditoría, no para el cliente. */
  readonly modelo: string;
};

/**
 * De dónde salen las imágenes.
 *
 * El identificador del modelo NO lo elige este paquete: viene de `model_tiers`,
 * como todo lo demás en Strappy, y el adaptador lo trae ya resuelto.
 */
export interface ImagenesPort {
  readonly modelo: string;
  generar(input: { prompt: string; medida: Medida }): Promise<ImagenGenerada>;
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

export type MedioBreve = {
  readonly id: number;
  readonly titulo: string;
  readonly url: string;
  /** «image», «video», «file»… */
  readonly tipo: string;
  readonly alt?: string;
};

/**
 * La biblioteca de imágenes del cliente.
 *
 * Hoy es la de WordPress; mañana puede ser otra. Subir devuelve el id, que es
 * justo lo que el Webmaster necesita para poner una imagen destacada.
 */
export interface MediosPort {
  /** Dominio o nombre del sitio: se usa para hablarle al cliente de SU sitio. */
  readonly sitio: string;
  listar(input: { buscar?: string }): Promise<readonly MedioBreve[]>;
  subir(input: {
    base64: string;
    mimeType: string;
    nombre: string;
    /** Texto alternativo: accesibilidad y, de paso, SEO. Nunca vacío. */
    alt: string;
  }): Promise<{ readonly id: number; readonly url: string }>;
}

// ---------------------------------------------------------------------------
// El estilo de la marca
// ---------------------------------------------------------------------------

export type ColoresDeMarca = {
  readonly primario: string;
  readonly acento: string;
  readonly texto: string;
  readonly fondo: string;
  readonly oscuro: string;
};

/**
 * Lo que hace que una imagen parezca del cliente y no de un banco de imágenes.
 *
 * `origen` dice de dónde salió: medido del sitio real, dictado por el cliente o
 * un valor por defecto. El agente tiene que poder decirlo cuando no es lo
 * primero, porque una imagen «con tu identidad» hecha sobre colores inventados
 * es una promesa que no se cumplió.
 */
export type EstiloDeMarca = {
  readonly origen: "sitio" | "cliente" | "por_defecto";
  readonly colores: ColoresDeMarca;
  readonly tipografia: {
    readonly titulos: string | null;
    readonly cuerpo: string | null;
  };
  /** De dónde se midió: «la portada», «/servicios/»… */
  readonly referencia?: string;
};

export const ESTILO_NEUTRO: EstiloDeMarca = {
  origen: "por_defecto",
  colores: {
    primario: "#1F2937",
    acento: "#2563EB",
    texto: "#374151",
    fondo: "#FFFFFF",
    oscuro: "#111827",
  },
  tipografia: { titulos: null, cuerpo: null },
};

// ---------------------------------------------------------------------------
// Aprobación y evidencia (misma forma que en los demás agentes, a propósito)
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
    siteId: string | null;
    huella: string;
    toolSlug: string;
    motivo: string;
    resumen: string;
    entrada: unknown;
  }): Promise<ApprovalRequest>;
}

/** La misma forma que usa el Webmaster para enseñar lo que hizo. */
export type CapturaEvidencia = {
  readonly herramienta: string;
  readonly mimeType: string;
  readonly url: string;
  readonly titulo: string;
  readonly base64: string;
};

export type ColectorCapturas = {
  push(captura: CapturaEvidencia): void;
};

// ---------------------------------------------------------------------------
// Contexto de trabajo
// ---------------------------------------------------------------------------

/** Tope de imágenes por encargo. Cada una cuesta créditos de verdad. */
export const MAX_IMAGENES_POR_ENCARGO = 3;

/**
 * Lo que el runtime inyecta en cada ejecución. NADA de esto puede venir del
 * modelo: si el modelo pudiera elegir la biblioteca donde publica, una
 * inyección de prompt acabaría subiendo imágenes al sitio de otro cliente.
 */
export type DisenoContext = {
  /** Conexión principal del encargo: sobre ella cuelgan las aprobaciones. */
  readonly conexionId: string;
  readonly taskId: string;
  /** Sin esto no se puede generar nada, y el agente tiene que decirlo. */
  readonly imagenes?: ImagenesPort;
  /** Sin esto se puede diseñar pero no publicar en el sitio del cliente. */
  readonly medios?: MediosPort;
  /** Colores y tipografías reales del cliente, si se pudieron medir. */
  readonly estilo?: EstiloDeMarca;
  readonly approvals: ApprovalPort;
  /** Donde se acumulan las imágenes para que el cliente las vea en el encargo. */
  readonly capturas?: ColectorCapturas;
  /** Cuántas imágenes se han generado ya en este encargo. Lo lleva el runtime. */
  readonly contador?: { generadas: number };
  /**
   * Las imágenes dibujadas en este encargo, por su identificador de borrador.
   *
   * Generar y publicar son dos pasos a propósito: entre medias la persona
   * aprueba. Los bytes se quedan aquí, en memoria de la ejecución, y NUNCA
   * viajan por el resultado que ve el modelo: una imagen en base64 dentro del
   * contexto de un LLM son cientos de miles de tokens pagados por el cliente.
   */
  readonly borradores?: Map<string, ImagenGenerada>;
  readonly maxImagenes?: number;
  /** Cuánto cuesta cada imagen, para poder decírselo al cliente. */
  readonly creditosPorImagen?: number;
  /** Primer contacto: mira y propone, no publica nada en el sitio. */
  readonly primerContacto?: boolean;
};

export function requireImagenes(diseno: DisenoContext, toolSlug: string): ImagenesPort {
  if (!diseno.imagenes) {
    throw new Error(
      `"${toolSlug}" necesita el generador de imágenes y este worker no lo tiene configurado. ` +
        `Dilo en el RESUMEN: hoy no puedo crear imágenes.`,
    );
  }
  return diseno.imagenes;
}

export function requireMedios(diseno: DisenoContext, toolSlug: string): MediosPort {
  if (!diseno.medios) {
    throw new Error(
      `"${toolSlug}" necesita el sitio del cliente conectado para publicar la imagen, y este espacio no lo tiene. ` +
        `Entrega la imagen en el RESUMEN y dile que conecte su sitio para que pueda subirla.`,
    );
  }
  return diseno.medios;
}
