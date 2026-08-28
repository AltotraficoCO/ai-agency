/**
 * Un consumidor es una fuente de trabajo que el worker atiende.
 *
 * Hoy solo hay uno —las tareas por encargo— pero el proceso está organizado
 * así para que los de WhatsApp (entrada de webhooks, cola de salida) sean una
 * entrada más en la lista y no otro proceso con su propio arranque, su propio
 * apagado y su propio manejo de señales.
 */
export interface Consumidor {
  readonly nombre: string;
  /**
   * Intenta hacer una unidad de trabajo.
   * Devuelve `true` si hizo algo: el bucle usa ese dato para volver a
   * consultar enseguida en vez de dormir el intervalo completo.
   */
  tick(): Promise<boolean>;
  cerrar?(): Promise<void>;
}
