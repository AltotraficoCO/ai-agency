/**
 * Ajustes de la plataforma: lo que se configura en el panel de super admin y
 * leen por igual la web y el worker.
 *
 * Las llaves de Wompi salen primero de la base y, campo por campo, de las
 * variables de entorno. Si no se puede descifrar lo guardado se trata como si no
 * estuviera: mejor no cobrar que cobrar con una llave equivocada.
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

export type AjustesDeCobro = {
  readonly config: ConfigCobro;
  readonly llaves: LlavesWompi;
};

type Fila = { key: string; value: unknown; encrypted: string | null };

export async function leerAjustesDeCobro(
  consulta: Consulta,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AjustesDeCobro> {
  const { rows } = await consulta(
    `select key, value, encrypted from public.platform_settings where key in ('cobro', 'wompi')`,
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

  return {
    config: normalizarConfigCobro(filas.find((f) => f.key === 'cobro')?.value),
    llaves: {
      publica: (typeof publica === 'string' && publica) || env['WOMPI_PUBLIC_KEY'] || '',
      privada: secretos.privada || env['WOMPI_PRIVATE_KEY'] || '',
      integridad: secretos.integridad || env['WOMPI_INTEGRITY_SECRET'] || '',
      eventos: secretos.eventos || env['WOMPI_EVENTS_SECRET'] || '',
    },
  };
}
