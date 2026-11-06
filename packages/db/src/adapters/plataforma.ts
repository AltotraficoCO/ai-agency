/**
 * Ajustes de la plataforma: lo que se configura en el panel de super admin y
 * leen por igual la web y el worker.
 *
 * Las llaves de Wompi salen primero de la base y, campo por campo, de las
 * variables de entorno. La clave de la cartera de modelos sale SOLO del panel:
 * no hay variable de entorno que la sustituya. Si no se puede descifrar lo
 * guardado se trata como si no estuviera: mejor no cobrar que cobrar con una
 * llave equivocada.
 */
import { normalizarConfigCobro, type ConfigCobro } from '@strappy/core/recargas';
import type { LlavesWompi } from '@strappy/core/wompi';
import { createHash } from 'node:crypto';
import { descifrar } from './secrets.js';

/**
 * La clave de los ajustes de plataforma. Es `APP_ENCRYPTION_KEY` porque es la
 * única que tienen a la vez la web y el worker: con otra, lo que guarda el panel
 * no lo podría leer quien cobra.
 */
export function claveDePlataforma(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secreto = env['APP_ENCRYPTION_KEY'];
  if (!secreto || secreto.length < 16) throw new Error('Falta APP_ENCRYPTION_KEY o es demasiado corta.');
  return createHash('sha256').update(secreto, 'utf8').digest();
}

type Consulta = (texto: string, valores?: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * La clave de OpenRouter, la cartera de modelos. Vacía si el panel no tiene
 * ninguna: la aplicación entra entonces en modo de ensayo y lo dice.
 */
export type ClaveDeCartera = {
  readonly openrouter: string;
  readonly origen: 'panel' | 'ninguno';
};

export type AjustesDeCobro = {
  readonly config: ConfigCobro;
  readonly llaves: LlavesWompi;
  readonly cartera: ClaveDeCartera;
};

/**
 * Deja la clave de la cartera donde la leen `@strappy/core` y `@strappy/rag`:
 * `OPENROUTER_API_KEY` en el entorno del proceso. Esos paquetes reciben el
 * entorno como un objeto y no saben de base de datos; la variable es el
 * conducto, no una configuración: lo que haya en ella al arrancar se ignora y
 * se sobrescribe con lo del panel, o se borra si el panel no tiene nada.
 * Devuelve si cambió, para rehacer los clientes que la tenían dentro.
 */
export function aplicarClaveDeCartera(cartera: ClaveDeCartera, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env['OPENROUTER_API_KEY'] ?? '') === cartera.openrouter) return false;
  if (cartera.openrouter) env['OPENROUTER_API_KEY'] = cartera.openrouter;
  else delete env['OPENROUTER_API_KEY'];
  return true;
}

type Fila = { key: string; value: unknown; encrypted: string | null };

export async function leerAjustesDeCobro(
  consulta: Consulta,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AjustesDeCobro> {
  const { rows } = await consulta(
    `select key, value, encrypted from public.platform_settings where key in ('cobro', 'wompi', 'modelos')`,
    [],
  );
  const filas = rows as Fila[];
  const wompi = filas.find((f) => f.key === 'wompi');
  const publica = (wompi?.value as { publica?: unknown } | undefined)?.publica;

  let secretos: Partial<LlavesWompi> = {};
  if (wompi?.encrypted) {
    try {
      secretos = JSON.parse(descifrar(wompi.encrypted, claveDePlataforma(env))) as Partial<LlavesWompi>;
    } catch (e) {
      console.error('[plataforma] no se pudieron descifrar las llaves de Wompi:', e instanceof Error ? e.message : e);
    }
  }

  const modelos = filas.find((f) => f.key === 'modelos');
  let openrouterDelPanel = '';
  if (modelos?.encrypted) {
    try {
      const guardado = JSON.parse(descifrar(modelos.encrypted, claveDePlataforma(env))) as { openrouter?: unknown };
      if (typeof guardado.openrouter === 'string') openrouterDelPanel = guardado.openrouter;
    } catch (e) {
      console.error('[plataforma] no se pudo descifrar la clave de la cartera:', e instanceof Error ? e.message : e);
    }
  }
  const cartera: ClaveDeCartera = openrouterDelPanel
    ? { openrouter: openrouterDelPanel, origen: 'panel' }
    : { openrouter: '', origen: 'ninguno' };

  return {
    config: normalizarConfigCobro(filas.find((f) => f.key === 'cobro')?.value),
    cartera,
    llaves: {
      publica: (typeof publica === 'string' && publica) || env['WOMPI_PUBLIC_KEY'] || '',
      privada: secretos.privada || env['WOMPI_PRIVATE_KEY'] || '',
      integridad: secretos.integridad || env['WOMPI_INTEGRITY_SECRET'] || '',
      eventos: secretos.eventos || env['WOMPI_EVENTS_SECRET'] || '',
    },
  };
}
