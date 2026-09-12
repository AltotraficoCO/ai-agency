/**
 * Consumidores registrados del worker.
 *
 * Añadir una fuente de trabajo es añadir una línea aquí y una entrada en la
 * lista del `Runner`: nunca otro proceso con su propio arranque y su propio
 * apagado.
 */
export type { Consumidor } from "./tipos.js";
export { ConsumidorDeTareas, type OpcionesConsumidorTareas } from "./tareas.js";
export { ConsumidorDeAnalisis, type OpcionesConsumidorAnalisis } from "./analisis.js";
export { ConsumidorDeVigilancia, type OpcionesConsumidorVigilancia } from "./vigilancia.js";
