/**
 * Canal WhatsApp.
 *
 * Este paquete es un ADAPTADOR: implementa `ChannelAdapter` de `@strappy/core`
 * y nada más. La dependencia va en un solo sentido —whatsapp → core— y nunca
 * al revés. Añadir este paquete no debe cambiar una sola línea de
 * `packages/core`; el día que haga falta, la abstracción se rompió.
 */
export * from "./types.js";
export * from "./errors.js";
export * from "./rate-limit.js";
export * from "./client.js";
export * from "./webhook.js";
export * from "./window.js";
export * from "./adapter.js";
export * from "./templates.js";
export * from "./analytics.js";
export * from "./signup.js";
