import "server-only";

/**
 * Crear el Cerebro del agente desde lo que Strap ya leyó.
 *
 * El rastreo se hace FUERA de la transacción y el indexado dentro. No es un
 * detalle: descargar cuarenta páginas puede tardar medio minuto, y sostener
 * una transacción de Postgres abierta durante ese rato mientras se espera a un
 * servidor ajeno es la manera clásica de agotar el pool en producción.
 *
 * Sin clave de modelo no hay embeddings. Cuando pasa, el Cerebro se crea igual
 * y la fuente queda registrada, pero el paso de indexado se declara omitido y
 * se dice por qué. Callarlo dejaría un Cerebro que existe, no responde nada y
 * nadie sabe por qué.
 */
import { crearEmbeddings, indexarDocumento, type DocumentoCrudo } from "@strappy/rag";
import { crearConocimientoDb, crearModelTiersPort } from "@strappy/db/adapters";
import { conEspacio } from "../db/pool";
import { hayModeloReal } from "../motor/modelo";
import { analizarSitio } from "./sitio";
import type { PasoConstruccion, SalidaProgreso } from "./tipos";

export type EntradaCerebro = {
  readonly workspaceId: string;
  readonly usuarioId: string;
  readonly nombre: string;
  readonly urls: readonly string[];
  readonly textos: readonly { titulo: string; contenido: string }[];
};

export type ResultadoCerebro = {
  readonly cerebroId: string | null;
  readonly progreso: SalidaProgreso;
};

export async function crearCerebroConFuentes(
  entrada: EntradaCerebro,
): Promise<ResultadoCerebro> {
  const pasos: PasoConstruccion[] = [];
  const documentos: DocumentoCrudo[] = [];

  for (const url of entrada.urls) {
    try {
      const sitio = await analizarSitio(url);
      for (const pagina of sitio.paginas) documentos.push(pagina.documento);
      pasos.push({
        etiqueta: `Leí ${sitio.paginas.length} de ${sitio.url}`,
        estado: sitio.paginas.length > 0 ? "hecho" : "fallido",
      });
    } catch (error) {
      pasos.push({
        etiqueta: `No pude leer ${url}`,
        estado: "fallido",
        detalle: error instanceof Error ? error.message : "dirección no válida",
      });
    }
  }

  for (const texto of entrada.textos) {
    documentos.push({ tipo: "text", titulo: texto.titulo, markdown: texto.contenido });
  }
  if (entrada.textos.length > 0) {
    pasos.push({ etiqueta: `Guardé ${entrada.textos.length} texto(s) tuyos`, estado: "hecho" });
  }

  if (documentos.length === 0) {
    return {
      cerebroId: null,
      progreso: {
        tipo: "progreso",
        titulo: "Preparando el conocimiento",
        pasos: [...pasos, { etiqueta: "No había nada que indexar", estado: "fallido" }],
        resumen: "No pude crear el Cerebro: no encontré contenido.",
      },
    };
  }

  return conEspacio(entrada.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string }>(
      `insert into public.brains (workspace_id, name, description, created_by)
       values ($1, $2, $3, $4)
       on conflict (workspace_id, name) do update set updated_at = now()
       returning id`,
      [
        scope.workspaceId,
        entrada.nombre,
        "Creado por Strap durante la construcción del agente.",
        entrada.usuarioId,
      ],
    );
    const cerebroId = rows[0]?.id;
    if (!cerebroId) throw new Error("No se pudo crear el Cerebro.");
    pasos.push({ etiqueta: `Creé el Cerebro «${entrada.nombre}»`, estado: "hecho" });

    if (!hayModeloReal()) {
      pasos.push({
        etiqueta: "No indexé el contenido",
        estado: "omitido",
        detalle: "Falta la clave de la cartera de modelos: sin ella no hay embeddings.",
      });
      return {
        cerebroId,
        progreso: {
          tipo: "progreso" as const,
          titulo: "Preparando el conocimiento",
          pasos,
          resumen: `Cerebro «${entrada.nombre}» creado con ${documentos.length} documento(s), pendiente de indexar.`,
        },
      };
    }

    const db = crearConocimientoDb(scope);
    const embeddings = crearEmbeddings({ modelTiers: crearModelTiersPort(scope) });
    let trozos = 0;
    let fallidos = 0;

    for (const documento of documentos) {
      try {
        const resultado = await indexarDocumento(
          { db, embeddings },
          { workspaceId: scope.workspaceId, cerebroId, documento },
        );
        trozos += resultado.trozosTotales;
      } catch {
        fallidos += 1;
      }
    }

    pasos.push({
      etiqueta: `Indexé ${trozos} pedacitos de información`,
      estado: trozos > 0 ? "hecho" : "fallido",
      ...(fallidos > 0 ? { detalle: `${fallidos} documento(s) fallaron.` } : {}),
    });

    await scope.query(
      `update public.brains set chunk_count = $3, status = 'ready', updated_at = now()
        where workspace_id = $1 and id = $2`,
      [scope.workspaceId, cerebroId, trozos],
    );

    return {
      cerebroId,
      progreso: {
        tipo: "progreso" as const,
        titulo: "Preparando el conocimiento",
        pasos,
        resumen: `Cerebro «${entrada.nombre}» con ${trozos} pedacitos listos.`,
      },
    };
  });
}
