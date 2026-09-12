/**
 * Dobles del medidor y del sitio.
 *
 * Existen para poder construir y probar el agente ENTERO sin clave de Google y
 * sin un WordPress delante. Cuando la clave esté puesta, el adaptador real
 * rellena la misma interfaz y estos tests siguen valiendo.
 *
 * Los números de los ejemplos no son de adorno: son los de un WordPress con
 * Elementor típico, que es lo que tienen los clientes. Una portada lenta por
 * imágenes gigantes y sin caché.
 */
import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
  BackupPort,
  Dispositivo,
  ImagenSitio,
  Medicion,
  PluginSitio,
  RendimientoPort,
  ResultadoPlugin,
  SitioPort,
} from "../ports.js";

export class BackupsEnMemoria implements BackupPort {
  readonly guardados: { id: string; alcance: string; snapshot: unknown; creadoEn: string }[] = [];
  #n = 0;

  async create(input: { alcance: string; snapshot: unknown }): Promise<string> {
    const id = `bk_${++this.#n}`;
    this.guardados.push({
      id,
      alcance: input.alcance,
      snapshot: input.snapshot,
      creadoEn: new Date(0).toISOString(),
    });
    return id;
  }

  async read(input: { backupId: string }) {
    return this.guardados.find((b) => b.id === input.backupId) ?? null;
  }
}

export class AprobacionesEnMemoria implements ApprovalPort {
  readonly solicitudes: {
    id: string;
    huella: string;
    toolSlug: string;
    resumen: string;
    motivo: string;
  }[] = [];
  readonly decisiones = new Map<string, ApprovalDecision>();
  /** Cuando es true, una persona aprueba todo al instante (camino feliz). */
  apruebaTodo = false;
  #n = 0;

  decidir(huella: string, decision: ApprovalDecision): void {
    this.decisiones.set(huella, decision);
  }

  async check(input: { huella: string }): Promise<ApprovalDecision | null> {
    if (this.apruebaTodo) return "aprobada";
    return this.decisiones.get(input.huella) ?? null;
  }

  async request(input: {
    huella: string;
    toolSlug: string;
    resumen: string;
    motivo: string;
  }): Promise<ApprovalRequest> {
    const id = `ap_${++this.#n}`;
    this.solicitudes.push({
      id,
      huella: input.huella,
      toolSlug: input.toolSlug,
      resumen: input.resumen,
      motivo: input.motivo,
    });
    return { id, decision: this.decisiones.get(input.huella) ?? null };
  }
}

/** Una portada lenta de verdad: tarda 4,8 s en celular y se mueve al cargar. */
export function medicionLenta(url = "https://negocio.com/", dispositivo: Dispositivo = "movil"): Medicion {
  return {
    url,
    dispositivo,
    medidoEn: "2026-09-12T10:00:00.000Z",
    laboratorio: { lcp: 4800, cls: 0.28, tbt: 640, ttfb: 420, puntuacion: 41 },
    campo: { lcp: 4100, inp: 420, cls: 0.19, dias: 28 },
    frenos: [
      { clave: "uses-optimized-images", titulo: "Efficiently encode images", ahorroMs: 1800, ahorroBytes: 2_400_000 },
      { clave: "render-blocking-resources", titulo: "Eliminate render-blocking resources", ahorroMs: 900 },
      { clave: "server-response-time", titulo: "Initial server response time", ahorroMs: 300 },
      { clave: "unused-css-rules", titulo: "Reduce unused CSS", ahorroMs: 150, ahorroBytes: 120_000 },
    ],
  };
}

/** La misma página después de arreglarla: ya abre en 2,1 s. */
export function medicionRapida(url = "https://negocio.com/", dispositivo: Dispositivo = "movil"): Medicion {
  return {
    url,
    dispositivo,
    medidoEn: "2026-09-12T10:30:00.000Z",
    laboratorio: { lcp: 2100, cls: 0.05, tbt: 180, ttfb: 380, puntuacion: 86 },
    campo: { lcp: 4100, inp: 420, cls: 0.19, dias: 28 },
    frenos: [{ clave: "unused-css-rules", titulo: "Reduce unused CSS", ahorroMs: 120 }],
  };
}

/** Una página sin tráfico suficiente: solo hay prueba de laboratorio. */
export function medicionSinGenteReal(url = "https://negocio.com/servicios/"): Medicion {
  return {
    url,
    dispositivo: "movil",
    medidoEn: "2026-09-12T10:05:00.000Z",
    laboratorio: { lcp: 3200, cls: 0.08, tbt: 300, ttfb: 500 },
    frenos: [{ clave: "modern-image-formats", titulo: "Serve images in next-gen formats", ahorroMs: 700 }],
  };
}

export type OpcionesMedidor = {
  readonly disponible?: boolean;
  /** Qué devolver, por URL. Si falta, se usa `porDefecto`. */
  readonly porUrl?: Readonly<Record<string, Medicion>>;
  readonly porDefecto?: Medicion;
  /** Mediciones en orden: la primera llamada devuelve la primera, etc. */
  readonly enOrden?: readonly Medicion[];
};

export class MedidorEnMemoria implements RendimientoPort {
  readonly fuente = "doble de pruebas";
  readonly disponible: boolean;
  readonly llamadas: { url: string; dispositivo: Dispositivo }[] = [];
  #i = 0;

  constructor(private readonly o: OpcionesMedidor = {}) {
    this.disponible = o.disponible ?? true;
  }

  async medir(input: { url: string; dispositivo: Dispositivo }): Promise<Medicion> {
    this.llamadas.push(input);
    if (this.o.enOrden?.length) {
      const m = this.o.enOrden[Math.min(this.#i, this.o.enOrden.length - 1)];
      this.#i += 1;
      if (m) return { ...m, url: input.url, dispositivo: input.dispositivo };
    }
    const porUrl = this.o.porUrl?.[input.url];
    if (porUrl) return { ...porUrl, dispositivo: input.dispositivo };
    const base = this.o.porDefecto ?? medicionLenta(input.url, input.dispositivo);
    return { ...base, url: input.url, dispositivo: input.dispositivo };
  }
}

/** Biblioteca de un WordPress real: fotos subidas desde el celular, sin tocar. */
export const IMAGENES_DE_EJEMPLO: readonly ImagenSitio[] = [
  {
    id: 101,
    url: "https://negocio.com/wp-content/uploads/2026/01/portada.jpg",
    titulo: "portada",
    bytes: 3_100_000,
    mime: "image/jpeg",
    ancho: 4032,
    alto: 3024,
  },
  {
    id: 102,
    url: "https://negocio.com/wp-content/uploads/2026/02/equipo.png",
    titulo: "equipo",
    bytes: 850_000,
    mime: "image/png",
    ancho: 1800,
    alto: 1200,
  },
  {
    id: 103,
    url: "https://negocio.com/wp-content/uploads/2026/03/logo.webp",
    titulo: "logo",
    bytes: 24_000,
    mime: "image/webp",
    ancho: 320,
    alto: 120,
  },
  {
    id: 104,
    url: "https://negocio.com/wp-content/uploads/2026/03/icono.webp",
    titulo: "icono",
    bytes: 8_000,
    mime: "image/webp",
    ancho: 64,
    alto: 64,
  },
];

export const PLUGINS_DE_EJEMPLO: readonly PluginSitio[] = [
  { slug: "elementor", nombre: "Elementor", activo: true },
  { slug: "contact-form-7", nombre: "Contact Form 7", activo: true },
  { slug: "woocommerce", nombre: "WooCommerce", activo: false },
  { slug: "revslider", nombre: "Slider Revolution", activo: true },
];

export type OpcionesSitio = {
  readonly url?: string;
  readonly puedeEscribir?: boolean;
  readonly imagenes?: readonly ImagenSitio[];
  readonly plugins?: readonly PluginSitio[];
  readonly paginas?: readonly { url: string; titulo: string }[];
};

export class SitioEnMemoria implements SitioPort {
  readonly url: string;
  readonly puedeEscribir: boolean;
  readonly llamadas: { metodo: string; entrada: unknown }[] = [];
  #plugins: PluginSitio[];
  #imagenes: readonly ImagenSitio[];
  #paginas: readonly { url: string; titulo: string }[];

  constructor(o: OpcionesSitio = {}) {
    this.url = o.url ?? "https://negocio.com";
    this.puedeEscribir = o.puedeEscribir ?? true;
    this.#plugins = [...(o.plugins ?? PLUGINS_DE_EJEMPLO)];
    this.#imagenes = o.imagenes ?? IMAGENES_DE_EJEMPLO;
    this.#paginas = o.paginas ?? [
      { url: "https://negocio.com/", titulo: "Inicio" },
      { url: "https://negocio.com/servicios/", titulo: "Servicios" },
      { url: "https://negocio.com/contacto/", titulo: "Contacto" },
    ];
  }

  async paginas() {
    this.llamadas.push({ metodo: "paginas", entrada: null });
    return this.#paginas;
  }

  async medios() {
    this.llamadas.push({ metodo: "medios", entrada: null });
    return this.#imagenes;
  }

  async plugins() {
    this.llamadas.push({ metodo: "plugins", entrada: null });
    return this.#plugins;
  }

  async instalarPlugin(input: { slug: string }): Promise<ResultadoPlugin> {
    this.llamadas.push({ metodo: "instalarPlugin", entrada: input });
    const existente = this.#plugins.find((p) => p.slug === input.slug);
    const nombre = existente?.nombre ?? input.slug;
    this.#plugins = [
      ...this.#plugins.filter((p) => p.slug !== input.slug),
      { slug: input.slug, nombre, activo: true },
    ];
    return { slug: input.slug, nombre, activo: true, yaEstaba: Boolean(existente) };
  }

  /** Para comprobar en los tests que NO se tocó nada sin aprobación. */
  escrituras(): number {
    return this.llamadas.filter((l) => l.metodo === "instalarPlugin").length;
  }
}
