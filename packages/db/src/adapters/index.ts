/**
 * Adaptadores: los puertos de `@strappy/core` y `@strappy/tools` implementados
 * contra el esquema real.
 *
 * Un archivo por puerto. Todos reciben un `TenantScope` —una transacción con
 * `SET LOCAL app.workspace_id` ya declarado— y ninguno acepta un `workspace_id`
 * suelto: el espacio lo fija quien abre el ámbito, no quien llama al método.
 */
export * from './util.js';
export * from './content.js';
export * from './spec.js';
export * from './conversations.js';
export * from './agents.js';
export * from './agent-runs.js';
export * from './outbound.js';
export * from './lock.js';
export * from './credits.js';
export * from './model-table.js';
export * from './knowledge.js';
export * from './contacts.js';
export * from './handover.js';
export * from './scheduling.js';
export * from './secrets.js';
export * from './http.js';
export * from './runtime.js';
