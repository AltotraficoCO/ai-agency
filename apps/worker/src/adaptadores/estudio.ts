/**
 * El estudio del Diseñador: con qué dibuja y dónde publica.
 *
 * Tres piezas que el paquete del agente no puede montar por sí solo:
 *
 *  · **Con qué dibuja.** El modelo de imagen sale de `model_tiers` (fila
 *    `imagen`), igual que el de texto sale de `negocio`. Ningún identificador
 *    de modelo vive en el código.
 *
 *  · **Con qué colores.** Los mide el Webmaster del sitio real del cliente
 *    (`leerDisenoDelSitio`). Aquí se traducen a la forma del Diseñador, que no
 *    sabe qué es WordPress: así el mismo agente sirve el día que un cliente
 *    tenga su web en otra cosa.
 *
 *  · **Dónde publica.** La biblioteca de medios del sitio, con las credenciales
 *    descifradas que el worker ya sabe cargar.
 *
 * Sin sitio conectado NO se falla: se devuelve el estudio sin biblioteca y sin
 * colores, y el agente lo explica con sus palabras. Un encargo que revienta con
 * un error técnico deja al cliente sin saber qué hacer.
 */
import { crearImagenesOpenRouter } from "@strappy/disenador/openrouter";
import type { EstiloDeMarca, ImagenesPort, MedioBreve, MediosPort } from "@strappy/disenador";
import { resolveModel, type ModelMode } from "@strappy/core";
import { cargarTablaDeModelos, cargarTarifaDeImagen } from "@strappy/db/adapters";
import {
  leerDisenoDelSitio,
  wordpress,
  type Estilo,
  type SitioContext,
  type WpCreds,
} from "@strappy/webmaster";
import type {
  EstudioDeDiseno,
  EstudioPort,
  SitePort,
  SqlExecutor,
  SqlPool,
  TenantScopeMinimo,
} from "../ports.js";

/** Del estilo que mide el Webmaster a la forma que entiende el Diseñador. */
export function aEstiloDeMarca(estilo: Estilo): EstiloDeMarca {
  return {
    origen: estilo.origen === "sitio" ? "sitio" : "por_defecto",
    colores: {
      primario: estilo.colores.primario,
      acento: estilo.colores.acento,
      texto: estilo.colores.texto,
      fondo: estilo.colores.fondo,
      oscuro: estilo.colores.oscuro,
    },
    tipografia: {
      titulos: estilo.tipografia.titulos.familia,
      cuerpo: estilo.tipografia.cuerpo.familia,
    },
    ...(estilo.referencia ? { referencia: estilo.referencia } : {}),
  };
}

/** La biblioteca del sitio, detrás del puerto del Diseñador. */
export function crearMediosWordpress(input: {
  creds: WpCreds;
  sitio: string;
  fetchSitio?: typeof globalThis.fetch;
}): MediosPort {
  const opciones = input.fetchSitio ? { fetch: input.fetchSitio } : {};
  return {
    sitio: input.sitio,
    async listar(entrada): Promise<readonly MedioBreve[]> {
      const medios = await wordpress.listarMedios(
        input.creds,
        { ...(entrada.buscar ? { buscar: entrada.buscar } : {}) },
        opciones,
      );
      return medios.map((m) => ({
        id: m.id,
        titulo: m.titulo,
        url: m.url,
        tipo: m.tipo,
        ...(m.alt ? { alt: m.alt } : {}),
      }));
    },
    async subir(entrada) {
      const bytes = Uint8Array.from(Buffer.from(entrada.base64, "base64"));
      const subida = await wordpress.subirMediaDesdeBytes(
        input.creds,
        {
          bytes,
          mimeType: entrada.mimeType,
          nombre: entrada.nombre,
          alt: entrada.alt,
        },
        opciones,
      );
      return { id: subida.id, url: subida.url };
    },
  };
}

export type OpcionesEstudio = {
  readonly sitios: SitePort;
  readonly pool: SqlPool;
  /** Se inyecta en los tests para no salir a internet. */
  readonly fetchSitio?: typeof globalThis.fetch;
  readonly fetchImagenes?: typeof globalThis.fetch;
};

export class EstudioPostgres implements EstudioPort {
  constructor(private readonly o: OpcionesEstudio) {}

  async cargar(input: {
    workspaceId: string;
    siteId: string | null;
    taskId: string;
    modo: ModelMode;
  }): Promise<EstudioDeDiseno> {
    const [imagenes, sitio] = await Promise.all([
      this.#imagenes(input.workspaceId, input.modo),
      input.siteId
        ? this.o.sitios.cargar({ workspaceId: input.workspaceId, siteId: input.siteId })
        : null,
    ]);

    const base: EstudioDeDiseno = {
      conexionId: input.siteId,
      negocio: "tu negocio",
      agentName: "Tu diseñador",
      ...(imagenes ? { imagenes: imagenes.puerto } : {}),
      ...(imagenes?.creditosPorImagen != null
        ? { creditosPorImagen: imagenes.creditosPorImagen }
        : {}),
    };

    if (!sitio || sitio.tipo !== "wp") return base;

    const creds = sitio.credenciales as WpCreds;
    const medios = crearMediosWordpress({
      creds,
      sitio: sitio.url.replace(/^https?:\/\//, ""),
      ...(this.o.fetchSitio ? { fetchSitio: this.o.fetchSitio } : {}),
    });

    return {
      ...base,
      conexionId: sitio.id,
      medios,
      agentName: sitio.agentName || base.agentName,
      ...(await this.#estilo(sitio.id, input.taskId, creds)),
    };
  }

  /**
   * El generador y lo que cuesta cada imagen que dibuje.
   *
   * Las dos cosas salen juntas porque son la misma decisión: en Lite dibuja
   * Gemini y en Max GPT Image 1, que cuesta cinco veces más. El precio se lee
   * de `credit_rates` por identificador de modelo, así que cambiar de
   * generador es cambiar una fila de `model_tiers` y el cobro se ajusta solo.
   *
   * Sin clave de la cartera no hay estudio, y el agente lo dice.
   */
  async #imagenes(
    workspaceId: string,
    modo: ModelMode,
  ): Promise<{ puerto: ImagenesPort; creditosPorImagen: number | null } | undefined> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return undefined;
    try {
      const ambito = this.#ambito(workspaceId);
      const tabla = await cargarTablaDeModelos(ambito);
      const eleccion = resolveModel(tabla, { mode: modo, task: "image" });
      const puerto = crearImagenesOpenRouter({
        modelo: eleccion.primary,
        apiKey,
        referer: "https://strappy.ai",
        titulo: "Strappy",
        ...(this.o.fetchImagenes ? { fetch: this.o.fetchImagenes } : {}),
      });
      // Si la tarifa no se puede leer NO se deja de dibujar: el bucle del
      // Diseñador tiene su constante de respaldo. Quedarse sin portada por no
      // poder consultar un precio sería el peor de los dos fallos.
      const creditosPorImagen = await cargarTarifaDeImagen(ambito, eleccion.primary).catch(
        () => null,
      );
      return { puerto, creditosPorImagen };
    } catch {
      // Sin fila para la tarea `imagen` el agente trabaja sin poder dibujar y
      // lo explica. Tumbar el encargo por esto no le diría nada al cliente.
      return undefined;
    }
  }

  /**
   * Los colores reales del sitio.
   *
   * Se mide sin navegador a propósito: abrir Chrome para leer una paleta cuesta
   * segundos y memoria en el VPS, y el respaldo por CSS de Elementor da el
   * mismo resultado en la mayoría de los sitios. Si no se puede medir, se
   * devuelve sin estilo y el agente avisa de que la imagen no llevará su
   * identidad.
   */
  async #estilo(
    siteId: string,
    taskId: string,
    creds: WpCreds,
  ): Promise<{ estilo?: EstiloDeMarca }> {
    const contexto = {
      siteId,
      taskId,
      tipo: "wp" as const,
      wp: creds,
      ...(this.o.fetchSitio ? { fetch: this.o.fetchSitio } : {}),
    } as unknown as SitioContext;
    try {
      const estilo = await leerDisenoDelSitio(contexto, {
        ...(this.o.fetchSitio ? { fetch: this.o.fetchSitio } : {}),
      });
      if (estilo.origen !== "sitio") return {};
      return { estilo: aEstiloDeMarca(estilo) };
    } catch {
      return {};
    }
  }

  #ambito(workspaceId: string): TenantScopeMinimo {
    const pool: SqlExecutor = this.o.pool;
    return {
      workspaceId,
      query: <T>(text: string, values?: readonly unknown[]) =>
        pool.query<T & Record<string, unknown>>(text, values),
      assertSameWorkspace(otro: string) {
        if (otro !== workspaceId) {
          throw new Error(`Se intentó usar el espacio ${otro} desde otro espacio.`);
        }
      },
    };
  }
}
