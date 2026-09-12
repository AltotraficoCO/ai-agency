export * from "./ports.js";
export * from "./context.js";
export * from "./analisis.js";
export * from "./informe.js";
export * from "./aprobacion.js";
export * from "./agent.js";
export * from "./loop.js";
export * from "./tools/index.js";
// `pasos.js` se importa por su propia ruta (`@strappy/administrativo/pasos`):
// define `recortar` igual que `tools/comun.js`, y reexportar ambos aquí dejaría
// el nombre ambiguo. Es la misma separación que en Marketing.
