/**
 * @strappy/rag · el motor de los «Cerebros».
 *
 * De puertas afuera esto no existe: el cliente ve un Cerebro con documentos,
 * páginas y notas, "47 pedacitos de información listos", y dos perillas
 * («¿cuánta información consulta?» y «¿qué tan exigente es al buscar?»).
 * Aquí dentro son fuentes, trozos, vectores y una fusión RRF que vive en SQL.
 */
export * from "./types.js";
export * from "./ports.js";
export * from "./texto.js";
export * from "./trocear.js";
export * from "./indexar.js";
export * from "./recuperar.js";
export * from "./verificar.js";
export * from "./cerebro.js";
export * from "./ingest/html.js";
export * from "./ingest/robots.js";
export * from "./ingest/web.js";
export * from "./ingest/archivos.js";
export * from "./adapters/embeddings.js";
export * from "./adapters/fetch.js";
