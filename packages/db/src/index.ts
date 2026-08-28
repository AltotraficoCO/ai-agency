/**
 * @strappy/db · esquema, tipos y helpers de tenencia.
 *
 * Las migraciones viven en `migrations/` y son la fuente de verdad; los tipos de
 * `types.ts` se mantienen a mano en paralelo. El test de aislamiento
 * (`tests/isolation.sql`) es el criterio de aceptacion del multi-tenant.
 */

export * from './types.js';
export * from './client.js';
