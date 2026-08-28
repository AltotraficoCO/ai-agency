/**
 * Piezas compartidas por todos los adaptadores.
 *
 * Regla que se repite en cada archivo de esta carpeta: TODA consulta lleva
 * `workspace_id = $1` como primer filtro, para apoyarse en los índices
 * compuestos que empiezan por él y para que un fallo de la RLS no sea el único
 * muro entre dos clientes.
 */
import type { TenantScope } from '../client.js';

/** Convierte un `numeric` de Postgres (que llega como texto) a número. */
export function aNumero(valor: unknown, porDefecto = 0): number {
  if (valor === null || valor === undefined) return porDefecto;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

export function aFecha(valor: unknown): Date {
  if (valor instanceof Date) return valor;
  return new Date(String(valor));
}

export function aFechaOpcional(valor: unknown): Date | undefined {
  if (valor === null || valor === undefined) return undefined;
  return aFecha(valor);
}

/**
 * Claves reservadas dentro de `conversations.variables`.
 *
 * El motor guarda ahí su estado interno (resumen rodante, dueño del lease) y
 * la interfaz muestra el resto como «datos recogidos». El prefijo de guion bajo
 * es lo que separa una cosa de la otra sin necesidad de otra tabla.
 */
export const CLAVE_RESUMEN = '_resumen';
export const CLAVE_DUENO_LOCK = '_lock_owner';

export function esClaveInterna(clave: string): boolean {
  return clave.startsWith('_');
}

/** Devuelve solo los datos que el agente averiguó, sin el estado del motor. */
export function datosRecogidos(
  variables: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(variables ?? {})) {
    if (esClaveInterna(k)) continue;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else {
      out[k] = JSON.stringify(v);
    }
  }
  return out;
}

export type ConScope = { readonly scope: TenantScope };

/** Comprueba que el ámbito abierto es el que la operación dice usar. */
export function mismoEspacio(scope: TenantScope, workspaceId: string): void {
  scope.assertSameWorkspace(workspaceId);
}
