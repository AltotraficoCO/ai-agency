/**
 * Indexado incremental de una fuente.
 *
 * La regla que gobierna todo este archivo: reindexar una fuente que no cambió
 * cuesta CERO llamadas de embedding. Se comprueba dos veces —hash de la fuente
 * entera, y hash de cada trozo— porque son dos ahorros distintos: el primero
 * evita hasta el troceado, el segundo evita pagar por 40 trozos cuando lo
 * único que cambió en la página fue el teléfono del pie.
 */
import type {
  ConocimientoDbPort,
  EmbeddingsPort,
  PlanEscritura,
  RegistroPort,
  TrozoAEscribir,
} from "./ports.js";
import { hashContenido } from "./texto.js";
import { trocear, type OpcionesTroceado } from "./trocear.js";
import type { DocumentoCrudo, IdCerebro, ResultadoIngesta, Trozo } from "./types.js";

export type OpcionesIndexado = {
  /** Reindexa aunque el hash coincida. Solo para «rehacer este documento». */
  readonly forzar?: boolean;
  readonly troceado?: Partial<OpcionesTroceado>;
  /** Tamaño de lote para el proveedor de embeddings. */
  readonly loteEmbeddings?: number;
};

export const LOTE_EMBEDDINGS = 96;

export type DepsIndexado = {
  readonly db: ConocimientoDbPort;
  readonly embeddings: EmbeddingsPort;
  readonly registro?: RegistroPort;
  readonly ahora?: () => Date;
};

/**
 * Calcula qué se conserva, qué se escribe y qué se borra.
 *
 * Es una función pura a propósito: es el corazón del ahorro y tiene que poder
 * probarse sin base de datos ni proveedor.
 */
export function planificar(input: {
  fuenteId: string;
  trozosNuevos: readonly Trozo[];
  trozosExistentes: readonly { id: string; posicion: number; hash: string }[];
}): {
  conservar: readonly { id: string; posicion: number; hash: string }[];
  aIncrustar: readonly Trozo[];
  eliminar: readonly string[];
} {
  const porHash = new Map<string, { id: string; posicion: number; hash: string }[]>();
  for (const t of input.trozosExistentes) {
    const lista = porHash.get(t.hash);
    if (lista) lista.push(t);
    else porHash.set(t.hash, [t]);
  }

  const conservar: { id: string; posicion: number; hash: string }[] = [];
  const aIncrustar: Trozo[] = [];
  const usados = new Set<string>();

  for (const nuevo of input.trozosNuevos) {
    const candidatos = porHash.get(nuevo.hash);
    const reutilizable = candidatos?.find((c) => !usados.has(c.id));
    if (reutilizable) {
      usados.add(reutilizable.id);
      // La posición puede haber cambiado (se insertó una sección arriba); el
      // vector no, porque el texto es idéntico. Se reposiciona sin incrustar.
      conservar.push({ id: reutilizable.id, posicion: nuevo.posicion, hash: nuevo.hash });
    } else {
      aIncrustar.push(nuevo);
    }
  }

  const eliminar = input.trozosExistentes.filter((t) => !usados.has(t.id)).map((t) => t.id);
  return { conservar, aIncrustar, eliminar };
}

/** Trocea el documento y devuelve también el hash de la fuente entera. */
export function prepararDocumento(
  documento: DocumentoCrudo,
  opciones?: Partial<OpcionesTroceado>,
): { hash: string; trozos: readonly Trozo[] } {
  return {
    hash: hashContenido(documento.markdown),
    trozos: trocear(documento.markdown, opciones),
  };
}

export async function incrustarPorLotes(
  embeddings: EmbeddingsPort,
  textos: readonly string[],
  tamañoLote = LOTE_EMBEDDINGS,
): Promise<readonly (readonly number[])[]> {
  if (textos.length === 0) return [];
  const salida: (readonly number[])[] = [];
  for (let i = 0; i < textos.length; i += tamañoLote) {
    const lote = textos.slice(i, i + tamañoLote);
    const vectores = await embeddings.incrustar(lote);
    if (vectores.length !== lote.length) {
      throw new Error(
        `El proveedor devolvió ${vectores.length} vectores para ${lote.length} textos.`,
      );
    }
    salida.push(...vectores);
  }
  return salida;
}

/**
 * Indexa un documento en un Cerebro. Idempotente: llamarlo dos veces con el
 * mismo contenido no toca la base ni gasta un céntimo.
 */
export async function indexarDocumento(
  deps: DepsIndexado,
  input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    documento: DocumentoCrudo;
    opciones?: OpcionesIndexado;
  },
): Promise<ResultadoIngesta> {
  const { db, embeddings } = deps;
  const ahora = deps.ahora ?? ((): Date => new Date());
  const { documento, opciones } = input;

  const fuente = await db.registrarFuente({
    workspaceId: input.workspaceId,
    cerebroId: input.cerebroId,
    tipo: documento.tipo,
    titulo: documento.titulo,
    ...(documento.uri ? { uri: documento.uri } : {}),
    ...(documento.mimeType ? { mimeType: documento.mimeType } : {}),
    ...(documento.metadata ? { metadata: documento.metadata } : {}),
  });

  const { hash, trozos } = prepararDocumento(documento, opciones?.troceado);

  // Atajo nº1: la fuente entera no cambió. Ni se trocea de verdad ni se toca
  // la base. Es lo que permite pulsar «Revisar si cambió» sobre 400 URL a
  // diario sin que cueste nada.
  if (!opciones?.forzar && fuente.hashContenido === hash && fuente.estado === "indexed") {
    return {
      fuenteId: fuente.id,
      titulo: documento.titulo,
      sinCambios: true,
      trozosTotales: trozos.length,
      trozosNuevos: 0,
      trozosReutilizados: trozos.length,
      trozosEliminados: 0,
      textosIncrustados: 0,
      estado: "indexed",
      necesitaOcr: documento.necesitaOcr === true,
    };
  }

  if (documento.necesitaOcr === true || trozos.length === 0) {
    const aviso =
      documento.necesitaOcr === true
        ? "El documento no tiene texto legible: probablemente sea un escaneo. Conviene revisarlo."
        : "El documento no tenía contenido aprovechable. Conviene revisarlo.";
    await db.marcarEstadoFuente({
      workspaceId: input.workspaceId,
      fuenteId: fuente.id,
      estado: "stale",
      hashContenido: hash,
      detalle: aviso,
      metadata: { revisar: true, motivo: documento.necesitaOcr === true ? "necesita_ocr" : "sin_contenido" },
      indexadoEn: ahora(),
    });
    return {
      fuenteId: fuente.id,
      titulo: documento.titulo,
      sinCambios: false,
      trozosTotales: 0,
      trozosNuevos: 0,
      trozosReutilizados: 0,
      trozosEliminados: 0,
      textosIncrustados: 0,
      estado: "stale",
      necesitaOcr: documento.necesitaOcr === true,
      aviso,
    };
  }

  await db.marcarEstadoFuente({
    workspaceId: input.workspaceId,
    fuenteId: fuente.id,
    estado: "indexing",
  });

  try {
    const existentes = opciones?.forzar
      ? []
      : await db.trozosDeFuente({ workspaceId: input.workspaceId, fuenteId: fuente.id });

    const plan = planificar({
      fuenteId: fuente.id,
      trozosNuevos: trozos,
      trozosExistentes: existentes.map((t) => ({ id: t.id, posicion: t.posicion, hash: t.hash })),
    });

    // Atajo nº2: solo se incrusta lo que de verdad cambió.
    const vectores = await incrustarPorLotes(
      embeddings,
      plan.aIncrustar.map((t) => t.contenido),
      opciones?.loteEmbeddings ?? LOTE_EMBEDDINGS,
    );

    const escribir: TrozoAEscribir[] = plan.aIncrustar.map((t, i) => ({
      posicion: t.posicion,
      contenido: t.contenido,
      hash: t.hash,
      tokens: t.tokensEstimados,
      embedding: vectores[i] ?? [],
      metadata: {
        titulo: documento.titulo,
        ruta: t.rutaEncabezados,
        ...(documento.uri ? { uri: documento.uri } : {}),
        modelo: embeddings.modelo,
      },
    }));

    const planEscritura: PlanEscritura = {
      fuenteId: fuente.id,
      conservar: plan.conservar,
      escribir,
      eliminar: plan.eliminar,
    };
    await db.aplicarPlan({ workspaceId: input.workspaceId, plan: planEscritura });

    await db.marcarEstadoFuente({
      workspaceId: input.workspaceId,
      fuenteId: fuente.id,
      estado: "indexed",
      hashContenido: hash,
      detalle: null,
      indexadoEn: ahora(),
    });

    return {
      fuenteId: fuente.id,
      titulo: documento.titulo,
      sinCambios: plan.aIncrustar.length === 0 && plan.eliminar.length === 0,
      trozosTotales: trozos.length,
      trozosNuevos: plan.aIncrustar.length,
      trozosReutilizados: plan.conservar.length,
      trozosEliminados: plan.eliminar.length,
      textosIncrustados: plan.aIncrustar.length,
      estado: "indexed",
      necesitaOcr: false,
    };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    deps.registro?.aviso("conocimiento.indexado_fallido", { fuenteId: fuente.id, detalle });
    await db.marcarEstadoFuente({
      workspaceId: input.workspaceId,
      fuenteId: fuente.id,
      estado: "error",
      detalle,
    });
    throw error;
  }
}
