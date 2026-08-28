/**
 * `Cerebro`: la fachada del paquete.
 *
 * Implementa el `KnowledgePort` que espera el motor (`@strappy/core`) y el que
 * espera la herramienta `buscar_conocimiento` (`@strappy/tools`) —que son la
 * misma forma— y encima expone la ingesta y el diagnóstico `explicarBusqueda`,
 * que es lo que alimenta el botón «Pruébalo» de la interfaz.
 */
import { indexarDocumento, type DepsIndexado, type OpcionesIndexado, prepararDocumento } from "./indexar.js";
import { ingerirArchivo, ingerirTexto, type ArchivoEntrante } from "./ingest/archivos.js";
import { rastrearSitio, type OpcionesWeb, type ResultadoRastreo } from "./ingest/web.js";
import { explicacionDelModo, modoEfectivo, type ModoConocimiento } from "./modo.js";
import type {
  ConocimientoDbPort,
  EmbeddingsPort,
  ExtractorDocumentosPort,
  FetchPort,
  GeneradorPreguntasPort,
  OcrPort,
  RegistroPort,
  RevectorizadoDbPort,
  TurnosPort,
} from "./ports.js";
import {
  revectorizarPendientes,
  type ResultadoRevectorizado,
} from "./revectorizar.js";
import { recuperar, TIMEOUT_MS, type ResultadoRecuperacion } from "./recuperar.js";
import type {
  AjustesRecuperacion,
  DocumentoCrudo,
  ExplicacionBusqueda,
  FragmentoRecuperado,
  IdCerebro,
  ResultadoIngesta,
} from "./types.js";
import { AJUSTES_POR_DEFECTO, TROZOS_POR_AMPLITUD } from "./types.js";
import { verificarFuente, type ResultadoVerificacion } from "./verificar.js";

export type DepsCerebro = {
  readonly db: ConocimientoDbPort;
  /**
   * Ausente = modo solo texto. Es la decisión explícita de trabajar sin
   * búsqueda por significado cuando no hay proveedor de embeddings (la cartera
   * del proyecto es OpenRouter, que no ofrece ninguno). Ver `modo.ts`.
   */
  readonly embeddings?: EmbeddingsPort;
  /** Solo hace falta el día que se active el modo completo. */
  readonly revectorizado?: RevectorizadoDbPort;
  readonly fetch?: FetchPort;
  readonly extractor?: ExtractorDocumentosPort;
  /** Gancho para el OCR con visión. Aún sin implementación: ver README. */
  readonly ocr?: OcrPort;
  readonly generadorPreguntas?: GeneradorPreguntasPort;
  /** Fuente de los turnos previos, para componer la consulta con dos. */
  readonly turnos?: TurnosPort;
  readonly registro?: RegistroPort;
  readonly timeoutMs?: number;
  readonly ahora?: () => Date;
  readonly forzarSoloTexto?: boolean;
};

/** Entrada de búsqueda del motor (`KnowledgePort.search`), más lo nuestro. */
export type EntradaBusqueda = {
  readonly workspaceId: string;
  readonly agentId?: string;
  readonly query: string;
  readonly limit: number;
  /** Si viene, se leen los turnos previos por el puerto para componer mejor. */
  readonly conversationId?: string;
  /** Turnos ya conocidos por quien llama, del más antiguo al más reciente. */
  readonly turnosUsuario?: readonly string[];
  readonly cerebroIds?: readonly IdCerebro[];
  readonly ajustes?: AjustesRecuperacion;
};

export class Cerebro {
  constructor(private readonly deps: DepsCerebro) {}

  // -------------------------------------------------------------------------
  // Recuperación
  // -------------------------------------------------------------------------

  /**
   * `KnowledgePort.search`. Nunca lanza y nunca tarda más de 800 ms: si el
   * conocimiento no llega a tiempo, devuelve vacío y el turno sigue sin él.
   */
  async search(input: EntradaBusqueda): Promise<readonly FragmentoRecuperado[]> {
    const r = await this.buscar(input);
    return r.fragmentos;
  }

  async buscar(input: EntradaBusqueda): Promise<ResultadoRecuperacion> {
    const cerebroIds = await this.resolverCerebros(input);
    const turnos = await this.resolverTurnos(input);
    return recuperar(
      {
        db: this.deps.db,
        ...(this.deps.embeddings ? { embeddings: this.deps.embeddings } : {}),
        ...(this.deps.registro ? { registro: this.deps.registro } : {}),
        ...(this.deps.forzarSoloTexto === undefined
          ? {}
          : { forzarSoloTexto: this.deps.forzarSoloTexto }),
        timeoutMs: this.deps.timeoutMs ?? TIMEOUT_MS,
      },
      {
        workspaceId: input.workspaceId,
        cerebroIds,
        turnosUsuario: turnos,
        ...(input.ajustes ? { ajustes: input.ajustes } : {}),
        limite: input.limit,
      },
    );
  }

  /**
   * Diagnóstico del botón «Pruébalo»: qué se habría usado, con qué puntuación
   * y por qué se descartó lo demás. Es lo que hace que un Cerebro sea
   * comprensible para alguien que no sabe qué es una búsqueda semántica.
   */
  async explicarBusqueda(
    consulta: string,
    contexto: {
      workspaceId: string;
      agentId?: string;
      cerebroIds?: readonly IdCerebro[];
      turnoAnterior?: string;
      ajustes?: AjustesRecuperacion;
    },
  ): Promise<ExplicacionBusqueda> {
    const ajustes = contexto.ajustes ?? AJUSTES_POR_DEFECTO;
    const cerebroIds = await this.resolverCerebros({
      workspaceId: contexto.workspaceId,
      ...(contexto.agentId ? { agentId: contexto.agentId } : {}),
      ...(contexto.cerebroIds ? { cerebroIds: contexto.cerebroIds } : {}),
      query: consulta,
      limit: TROZOS_POR_AMPLITUD[ajustes.amplitud],
    });

    const turnos = contexto.turnoAnterior ? [contexto.turnoAnterior, consulta] : [consulta];
    const r = await recuperar(
      {
        db: this.deps.db,
        ...(this.deps.embeddings ? { embeddings: this.deps.embeddings } : {}),
        ...(this.deps.registro ? { registro: this.deps.registro } : {}),
        ...(this.deps.forzarSoloTexto === undefined
          ? {}
          : { forzarSoloTexto: this.deps.forzarSoloTexto }),
        // Probar no es responder: aquí se prefiere esperar a mentir con vacío.
        timeoutMs: 5_000,
      },
      { workspaceId: contexto.workspaceId, cerebroIds, turnosUsuario: turnos, ajustes },
    );

    const fuentes = await this.deps.db
      .fuentesPorId({ workspaceId: contexto.workspaceId, ids: [...new Set(r.candidatos.map((c) => c.sourceId))] })
      .catch(() => new Map<string, { titulo: string; uri: string | null }>());

    return {
      consultaUsada: r.consulta,
      ajustes,
      cerebrosConsultados: cerebroIds,
      degradado: r.degradado,
      milisegundos: r.milisegundos,
      modo: r.modo,
      // Sin esto, un cerebro en modo solo texto parece uno roto: encuentra el
      // precio si preguntas con las palabras del catálogo y no encuentra nada
      // si preguntas de otra manera, y nadie sabe por qué.
      explicacion: r.explicacion,
      candidatos: r.candidatos.map((c) => {
        const cita = fuentes.get(c.sourceId);
        const documento =
          cita?.titulo ??
          (typeof c.metadata["titulo"] === "string" ? (c.metadata["titulo"] as string) : "Documento");
        const uri = cita?.uri ?? null;
        return {
          documento,
          ...(uri ? { fuente: uri } : {}),
          extracto: extracto(c.contenido),
          puntuacion: c.puntuacion,
          usado: c.usado,
          motivo: c.motivo,
        };
      }),
    };
  }

  /** Con qué mitad de la búsqueda está trabajando este Cerebro ahora mismo. */
  get modo(): ModoConocimiento {
    return modoEfectivo({
      embeddings: this.deps.embeddings,
      ...(this.deps.forzarSoloTexto === undefined
        ? {}
        : { forzarSoloTexto: this.deps.forzarSoloTexto }),
    });
  }

  /** El mismo texto llano que ve quien pulsa «Pruébalo». */
  get explicacionDelModo(): string {
    return explicacionDelModo(this.modo);
  }

  // -------------------------------------------------------------------------
  // Ingesta
  // -------------------------------------------------------------------------

  /** Nota pegada a mano en la interfaz. */
  async agregarTexto(input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    titulo: string;
    texto: string;
    opciones?: OpcionesIndexado;
  }): Promise<ResultadoIngesta> {
    return this.indexar(input.workspaceId, input.cerebroId, ingerirTexto(input), input.opciones);
  }

  /** Documento subido: PDF, DOCX, CSV, Markdown o texto. */
  async agregarArchivo(input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    archivo: ArchivoEntrante;
    opciones?: OpcionesIndexado;
  }): Promise<ResultadoIngesta> {
    const documento = await ingerirArchivo(input.archivo, this.deps.extractor);
    return this.indexar(input.workspaceId, input.cerebroId, documento, input.opciones);
  }

  /**
   * Página web o sitio entero. Descubre por sitemap y, si no hay, rastrea en
   * anchura hasta 50 páginas del mismo dominio respetando robots.txt.
   */
  async agregarSitio(input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    url: string;
    web?: Partial<OpcionesWeb>;
    opciones?: OpcionesIndexado;
  }): Promise<{ rastreo: ResultadoRastreo; resultados: readonly ResultadoIngesta[] }> {
    if (!this.deps.fetch) {
      throw new Error("Para leer páginas web hace falta un puerto de red y no hay ninguno configurado.");
    }
    const rastreo = await rastrearSitio(this.deps.fetch, input.url, input.web);
    const resultados: ResultadoIngesta[] = [];
    for (const pagina of rastreo.paginas) {
      resultados.push(
        await this.indexar(input.workspaceId, input.cerebroId, pagina.documento, input.opciones),
      );
    }
    return { rastreo, resultados };
  }

  /**
   * «Revisar si cambió»: reindexa una fuente ya conocida. Si el contenido es
   * idéntico, no gasta ni una llamada de embedding.
   */
  async revisarSiCambio(input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    documento: DocumentoCrudo;
  }): Promise<ResultadoIngesta> {
    return this.indexar(input.workspaceId, input.cerebroId, input.documento);
  }

  /** Ingesta + verificación de calidad en una sola llamada. */
  async agregarYVerificar(input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    documento: DocumentoCrudo;
    opciones?: OpcionesIndexado;
  }): Promise<{ ingesta: ResultadoIngesta; verificacion: ResultadoVerificacion | null }> {
    const ingesta = await this.indexar(
      input.workspaceId,
      input.cerebroId,
      input.documento,
      input.opciones,
    );
    // Verificar una fuente que no cambió es gastar embeddings para confirmar lo
    // que ya se confirmó la vez anterior.
    if (ingesta.sinCambios || ingesta.trozosTotales === 0) {
      return { ingesta, verificacion: null };
    }
    const { trozos } = prepararDocumento(input.documento, input.opciones?.troceado);
    const verificacion = await verificarFuente(
      {
        db: this.deps.db,
        ...(this.deps.embeddings ? { embeddings: this.deps.embeddings } : {}),
        ...(this.deps.generadorPreguntas ? { generador: this.deps.generadorPreguntas } : {}),
        ...(this.deps.registro ? { registro: this.deps.registro } : {}),
      },
      {
        workspaceId: input.workspaceId,
        cerebroId: input.cerebroId,
        fuenteId: ingesta.fuenteId,
        documento: input.documento,
        trozos,
      },
    );
    return { ingesta, verificacion };
  }

  /**
   * Completa el conocimiento que se indexó sin búsqueda por significado.
   *
   * Solo tiene sentido cuando ya hay proveedor de embeddings: recorre los
   * trozos sin vector y los vectoriza sin volver a descargar ni trocear nada.
   */
  async completarPendientes(input: {
    workspaceId: string;
    cerebroId?: IdCerebro;
    maximo?: number;
  }): Promise<ResultadoRevectorizado> {
    if (!this.deps.embeddings) {
      throw new Error(
        "Todavía no hay proveedor de búsqueda por significado configurado: pon OPENAI_API_KEY y vuelve a intentarlo.",
      );
    }
    if (!this.deps.revectorizado) {
      throw new Error(
        "Falta el acceso a los fragmentos pendientes: quien monta el Cerebro debe aportar el puerto de reindexado.",
      );
    }
    return revectorizarPendientes(
      {
        db: this.deps.revectorizado,
        embeddings: this.deps.embeddings,
        ...(this.deps.registro ? { registro: this.deps.registro } : {}),
      },
      {
        workspaceId: input.workspaceId,
        ...(input.cerebroId ? { cerebroId: input.cerebroId } : {}),
        ...(input.maximo !== undefined ? { maximo: input.maximo } : {}),
      },
    );
  }

  // -------------------------------------------------------------------------

  private async indexar(
    workspaceId: string,
    cerebroId: IdCerebro,
    documento: DocumentoCrudo,
    opciones?: OpcionesIndexado,
  ): Promise<ResultadoIngesta> {
    const deps: DepsIndexado = {
      db: this.deps.db,
      ...(this.deps.embeddings ? { embeddings: this.deps.embeddings } : {}),
      ...(this.deps.forzarSoloTexto === undefined
        ? {}
        : { forzarSoloTexto: this.deps.forzarSoloTexto }),
      ...(this.deps.registro ? { registro: this.deps.registro } : {}),
      ...(this.deps.ahora ? { ahora: this.deps.ahora } : {}),
    };
    return indexarDocumento(deps, {
      workspaceId,
      cerebroId,
      documento,
      ...(opciones ? { opciones } : {}),
    });
  }

  private async resolverCerebros(input: EntradaBusqueda): Promise<readonly IdCerebro[]> {
    if (input.cerebroIds && input.cerebroIds.length > 0) return input.cerebroIds;
    if (!input.agentId) return [];
    try {
      const cerebros = await this.deps.db.cerebrosDeAgente({
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      });
      return cerebros.map((c) => c.id);
    } catch (error) {
      this.deps.registro?.aviso("conocimiento.cerebros_no_resueltos", {
        agentId: input.agentId,
        detalle: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Los dos últimos turnos del usuario. Si quien llama ya los tiene, se usan
   * tal cual; si solo hay una conversación, se piden por el puerto; y si no
   * hay ninguna de las dos cosas, se cae al comportamiento antiguo (un turno),
   * que sigue funcionando aunque resuelva peor las preguntas de seguimiento.
   */
  private async resolverTurnos(input: EntradaBusqueda): Promise<readonly string[]> {
    if (input.turnosUsuario && input.turnosUsuario.length > 0) {
      const ultimos = input.turnosUsuario.slice(-2);
      return ultimos[ultimos.length - 1] === input.query ? ultimos : [...ultimos, input.query];
    }
    if (input.conversationId && this.deps.turnos) {
      try {
        const previos = await this.deps.turnos.ultimosTurnosUsuario({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          cuantos: 2,
        });
        const ultimos = previos.slice(-2);
        return ultimos[ultimos.length - 1] === input.query ? ultimos : [...ultimos.slice(-1), input.query];
      } catch {
        return [input.query];
      }
    }
    return [input.query];
  }
}

function extracto(texto: string, maximo = 260): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo).replace(/\s+\S*$/, "")}…`;
}
