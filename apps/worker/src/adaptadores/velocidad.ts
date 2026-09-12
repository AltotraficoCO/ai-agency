/**
 * Con qué mide el Velocista y sobre qué sitio trabaja.
 *
 * Dos adaptadores y un cargador:
 *  · `MedidorPageSpeed` habla con PageSpeed Insights, que es lo que usa Google
 *    para decidir si una página es rápida. La clave es NUESTRA y es gratuita
 *    (25.000 consultas al día): el cliente no tiene que tramitar nada.
 *  · `SitioWordPress` reutiliza el cliente de WordPress del Webmaster. No hay
 *    una segunda forma de hablar con WordPress en este producto.
 *  · `VelocidadPostgres` arma lo anterior para un espacio, con las credenciales
 *    descifradas igual que hace `SitiosPostgres`.
 *
 * Sin clave configurada el medidor se declara NO disponible y el agente lo dice
 * («no pude medir tu página») en vez de inventarse un tiempo. Eso es deliberado:
 * en velocidad, opinar sin medir es exactamente el servicio que el cliente ya
 * compró una vez y no le sirvió.
 */
import {
  decryptJson,
  wordpress,
  type ConectorCreds,
  type WpCreds,
} from "@strappy/webmaster";
import type {
  Dispositivo,
  Freno,
  ImagenSitio,
  Laboratorio,
  Medicion,
  PluginSitio,
  RendimientoPort,
  ResultadoPlugin,
  SitioPort,
} from "@strappy/velocista";
import type { SqlExecutor, VelocidadDelSitio, VelocistaPort } from "../ports.js";

// ---------------------------------------------------------------------------
// PageSpeed Insights
// ---------------------------------------------------------------------------

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Medir de verdad tarda: una página lenta puede irse a medio minuto. */
const TIMEOUT_MEDICION_MS = 90_000;

type AuditoriaPsi = {
  id?: string;
  title?: string;
  score?: number | null;
  numericValue?: number;
  details?: { overallSavingsMs?: number; overallSavingsBytes?: number };
};

type RespuestaPsi = {
  lighthouseResult?: {
    audits?: Record<string, AuditoriaPsi>;
    categories?: { performance?: { score?: number | null } };
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number }>;
  };
  error?: { message?: string };
};

function numero(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** De las auditorías de Lighthouse a las tres métricas y al tiempo de servidor. */
export function laboratorioDe(audits: Record<string, AuditoriaPsi>, puntuacion?: number): Laboratorio {
  return {
    ...(numero(audits["largest-contentful-paint"]?.numericValue) !== undefined
      ? { lcp: audits["largest-contentful-paint"]?.numericValue }
      : {}),
    ...(numero(audits["cumulative-layout-shift"]?.numericValue) !== undefined
      ? { cls: audits["cumulative-layout-shift"]?.numericValue }
      : {}),
    ...(numero(audits["total-blocking-time"]?.numericValue) !== undefined
      ? { tbt: audits["total-blocking-time"]?.numericValue }
      : {}),
    ...(numero(audits["server-response-time"]?.numericValue) !== undefined
      ? { ttfb: audits["server-response-time"]?.numericValue }
      : {}),
    ...(puntuacion !== undefined ? { puntuacion: Math.round(puntuacion * 100) } : {}),
  };
}

/**
 * De los datos de usuarios reales (CrUX) a las tres métricas.
 *
 * Ojo con el desplazamiento: Google lo publica multiplicado por cien para que
 * sea entero. Sin dividir, un 0,19 se convertiría en un 19 y el agente diría
 * que la web del cliente se mueve como un terremoto.
 */
export function campoDe(metrics: Record<string, { percentile?: number }> | undefined) {
  if (!metrics) return undefined;
  const lcp = numero(metrics["LARGEST_CONTENTFUL_PAINT_MS"]?.percentile);
  const inp = numero(metrics["INTERACTION_TO_NEXT_PAINT"]?.percentile);
  const clsCrudo = numero(metrics["CUMULATIVE_LAYOUT_SHIFT_SCORE"]?.percentile);
  if (lcp === undefined && inp === undefined && clsCrudo === undefined) return undefined;
  return {
    ...(lcp !== undefined ? { lcp } : {}),
    ...(inp !== undefined ? { inp } : {}),
    ...(clsCrudo !== undefined ? { cls: clsCrudo / 100 } : {}),
    dias: 28,
  };
}

/** Las auditorías que dicen cuánto se ganaría arreglando algo. */
export function frenosDe(audits: Record<string, AuditoriaPsi>): readonly Freno[] {
  const frenos: Freno[] = [];
  for (const [clave, a] of Object.entries(audits)) {
    const ahorroMs = numero(a.details?.overallSavingsMs);
    const ahorroBytes = numero(a.details?.overallSavingsBytes);
    const esProblema = a.score !== null && a.score !== undefined && a.score < 0.9;
    if (!esProblema) continue;
    if (ahorroMs === undefined && ahorroBytes === undefined) continue;
    frenos.push({
      clave,
      titulo: a.title ?? clave,
      ...(ahorroMs !== undefined ? { ahorroMs } : {}),
      ...(ahorroBytes !== undefined ? { ahorroBytes } : {}),
    });
  }
  return frenos;
}

export class MedidorPageSpeed implements RendimientoPort {
  readonly fuente = "PageSpeed Insights, de Google";
  readonly disponible: boolean;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.disponible = Boolean(apiKey);
  }

  async medir(input: { url: string; dispositivo: Dispositivo }): Promise<Medicion> {
    const parametros = new URLSearchParams({
      url: input.url,
      strategy: input.dispositivo === "movil" ? "mobile" : "desktop",
      category: "performance",
    });
    if (this.apiKey) parametros.set("key", this.apiKey);

    const res = await this.fetchImpl(`${PSI}?${parametros.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MEDICION_MS),
    });
    const cuerpo = (await res.json().catch(() => ({}))) as RespuestaPsi;
    if (!res.ok) {
      // El mensaje de Google trae la URL completa, y la URL lleva la clave
      // dentro. El agente tapa secretos antes de enseñar nada, pero aquí ya se
      // recorta: cuanto menos viaje, mejor.
      const detalle = (cuerpo.error?.message ?? `error ${res.status}`).slice(0, 200);
      throw new Error(`No pude medir ${input.url}: ${detalle}`);
    }

    const audits = cuerpo.lighthouseResult?.audits ?? {};
    const puntuacion = cuerpo.lighthouseResult?.categories?.performance?.score;
    const campo = campoDe(cuerpo.loadingExperience?.metrics);
    return {
      url: input.url,
      dispositivo: input.dispositivo,
      medidoEn: new Date().toISOString(),
      laboratorio: laboratorioDe(audits, puntuacion ?? undefined),
      ...(campo ? { campo } : {}),
      frenos: frenosDe(audits),
    };
  }
}

// ---------------------------------------------------------------------------
// El sitio, sobre el WordPress que ya sabemos hablar
// ---------------------------------------------------------------------------

/** Cuántas imágenes se pesan de verdad. Cada una es una petición al sitio. */
const IMAGENES_A_PESAR = 15;

export class SitioWordPress implements SitioPort {
  readonly puedeEscribir = true;

  constructor(
    readonly url: string,
    private readonly creds: WpCreds,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async paginas(): Promise<readonly { url: string; titulo: string }[]> {
    const contenido = await wordpress.listarContenido(this.creds, {});
    return contenido
      .filter((c) => c.status === "publish" && c.link)
      .map((c) => ({ url: c.link, titulo: c.titulo }));
  }

  /**
   * La biblioteca de medios NO publica el peso de cada archivo, así que se
   * pregunta por él con una petición de solo cabeceras. Sin el peso real, «esta
   * imagen es pesada» sería una corazonada, y el cliente merece el número.
   */
  async medios(): Promise<readonly ImagenSitio[]> {
    const medios = await wordpress.listarMedios(this.creds, {}, {});
    const imagenes = medios.filter((m) => m.tipo === "image" && m.url);
    const conPeso = await Promise.all(
      imagenes.slice(0, IMAGENES_A_PESAR).map(async (m) => {
        const bytes = await this.#pesar(m.url);
        return {
          id: m.id,
          url: m.url,
          titulo: m.titulo || m.alt || `imagen ${m.id}`,
          ...(bytes !== undefined ? { bytes } : {}),
          ...(m.mime ? { mime: m.mime } : {}),
        } satisfies ImagenSitio;
      }),
    );
    const resto = imagenes.slice(IMAGENES_A_PESAR).map(
      (m): ImagenSitio => ({
        id: m.id,
        url: m.url,
        titulo: m.titulo || m.alt || `imagen ${m.id}`,
        ...(m.mime ? { mime: m.mime } : {}),
      }),
    );
    return [...conPeso, ...resto];
  }

  async #pesar(url: string): Promise<number | undefined> {
    try {
      const res = await this.fetchImpl(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      const largo = res.headers.get("content-length");
      const bytes = largo ? Number.parseInt(largo, 10) : Number.NaN;
      return Number.isFinite(bytes) ? bytes : undefined;
    } catch {
      // Un archivo que no se deja pesar no es un fallo de la tarea: se queda
      // sin peso y el análisis lo ignora en vez de inventarlo.
      return undefined;
    }
  }

  async plugins(): Promise<readonly PluginSitio[]> {
    const lista = await wordpress.listarPlugins(this.creds, {});
    return lista.map((p) => ({
      // WordPress identifica el plugin por su ruta (`litespeed-cache/litespeed.php`).
      slug: p.plugin.split("/")[0] ?? p.plugin,
      nombre: p.name,
      activo: p.status === "active",
    }));
  }

  async instalarPlugin(input: { slug: string }): Promise<ResultadoPlugin> {
    const antes = await this.plugins();
    const yaEstaba = antes.some((p) => p.slug === input.slug);
    const r = await wordpress.instalarPlugin(this.creds, input.slug, {});
    return {
      slug: input.slug,
      nombre: r.name || input.slug,
      activo: r.status === "active",
      yaEstaba,
    };
  }
}

// ---------------------------------------------------------------------------
// De dónde sale todo para un espacio
// ---------------------------------------------------------------------------

type MetadatosSitio = {
  url?: string;
  tipo?: string;
  agent_name?: string;
  primer_contacto?: boolean;
};

export class VelocidadPostgres implements VelocistaPort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly claveMaestra: Buffer,
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async cargar(input: {
    workspaceId: string;
    conexionId: string | null;
  }): Promise<VelocidadDelSitio> {
    const espacio = await this.sql.query<{ nombre: string | null }>(
      `select name as nombre from public.workspaces where id = $1`,
      [input.workspaceId],
    );
    const negocio = espacio.rows[0]?.nombre?.trim() || "tu negocio";
    const medidor = new MedidorPageSpeed(this.apiKey, this.fetchImpl);

    // La clave viaja como secreto a tapar: cuando PageSpeed falla, su error
    // trae la URL completa de la petición, y la clave va dentro de esa URL.
    const secretos = this.apiKey ? [this.apiKey] : [];

    const sinSitio: VelocidadDelSitio = {
      conexionId: null,
      negocio,
      agentName: "Tu agente de velocidad",
      rendimiento: medidor,
      secretos,
    };

    const { rows } = input.conexionId
      ? await this.sql.query<{
          id: string;
          credentials_encrypted: string | null;
          metadata: MetadatosSitio | null;
          status: string;
        }>(
          `select id, credentials_encrypted, metadata, status
             from public.connections
            where id = $1 and workspace_id = $2`,
          [input.conexionId, input.workspaceId],
        )
      : await this.sql.query<{
          id: string;
          credentials_encrypted: string | null;
          metadata: MetadatosSitio | null;
          status: string;
        }>(
          `select id, credentials_encrypted, metadata, status
             from public.connections
            where workspace_id = $1 and provider = 'wordpress' and status = 'active'
            order by updated_at desc
            limit 1`,
          [input.workspaceId],
        );

    const fila = rows[0];
    if (!fila || fila.status !== "active" || !fila.credentials_encrypted) return sinSitio;
    // El sitio del conector propio todavía no se mide desde aquí: sus
    // credenciales no son de WordPress y el adaptador sería otro.
    if (fila.metadata?.tipo === "custom") return sinSitio;

    let credenciales: WpCreds | ConectorCreds;
    try {
      credenciales = decryptJson<WpCreds | ConectorCreds>(
        fila.credentials_encrypted,
        this.claveMaestra,
      );
    } catch {
      throw new Error(
        "Las credenciales guardadas son indescifrables con la clave actual. Hay que reconectar el sitio.",
      );
    }
    if (!("url" in credenciales)) return sinSitio;

    const url = fila.metadata?.url ?? credenciales.url;
    return {
      conexionId: fila.id,
      negocio,
      agentName: fila.metadata?.agent_name ?? "Tu agente de velocidad",
      sitio: new SitioWordPress(url, credenciales, this.fetchImpl),
      rendimiento: medidor,
      secretos: [...secretos, credenciales.appPassword].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
      ...(fila.metadata?.primer_contacto === true ? { primerContacto: true } : {}),
    };
  }
}
