export * from "./ports.js";
export * from "./context.js";
export * from "./analisis.js";
export * from "./aprobacion.js";
export * from "./agent.js";
export * from "./loop.js";
export * from "./tools/index.js";
export { etiquetaDePaso as etiquetaDePasoVelocidad, detalleDePaso as detalleDePasoVelocidad } from "./pasos.js";
// `pasos.js` se importa por su propia ruta (`@strappy/velocista/pasos`): define
// `recortar` igual que otros módulos, y reexportar ambos aquí dejaría el nombre
// ambiguo. Es la misma separación que en Marketing y en el financiero.
