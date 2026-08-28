/**
 * `SecretResolver` sobre `connections`.
 *
 * La credencial se guarda cifrada con AES-256-GCM y la clave vive en
 * `ENCRYPTION_KEY`, jamás en la base ni en el árbol. El valor descifrado NUNCA
 * se devuelve al modelo: solo lo usa el puerto HTTP al montar la petición.
 *
 * Formato del campo `credentials_encrypted`: base64(iv | tag | ciphertext),
 * con iv de 12 bytes y tag de 16, que es el formato estándar de GCM en Node.
 */
import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import type { SecretResolver } from '@strappy/tools';
import type { TenantScope } from '../client.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class ClaveDeCifradoAusenteError extends Error {
  constructor() {
    super(
      'Falta ENCRYPTION_KEY (32 bytes en base64). Sin ella no se pueden leer las credenciales guardadas.',
    );
    this.name = 'ClaveDeCifradoAusenteError';
  }
}

export function leerClave(base64: string | undefined): Buffer {
  if (!base64) throw new ClaveDeCifradoAusenteError();
  const clave = Buffer.from(base64, 'base64');
  if (clave.length !== 32) {
    throw new Error('ENCRYPTION_KEY debe tener exactamente 32 bytes en base64.');
  }
  return clave;
}

export function cifrar(texto: string, clave: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), datos]).toString('base64');
}

export function descifrar(paquete: string, clave: Buffer): string {
  const bytes = Buffer.from(paquete, 'base64');
  if (bytes.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Credencial cifrada con formato inesperado.');
  }
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const datos = bytes.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', clave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
}

/**
 * Referencias admitidas: `conexion:<uuid>` y `conexion:<uuid>#<campo>`, donde el
 * campo indexa el JSON descifrado. Cualquier otra forma se rechaza: si el
 * formato fuera libre, una inyección de prompt podría pedir una referencia
 * arbitraria.
 */
const REFERENCIA = /^conexion:([0-9a-f-]{36})(?:#([a-z0-9_]+))?$/i;

export function crearSecretResolver(
  scope: TenantScope,
  opciones: { encryptionKey?: string } = {},
): SecretResolver {
  const ws = scope.workspaceId;

  return {
    async resolve({ workspaceId, ref }) {
      scope.assertSameWorkspace(workspaceId);
      const m = REFERENCIA.exec(ref);
      if (!m) {
        throw new Error(
          `Referencia de credencial inválida: "${ref}". Usa "conexion:<id>" o "conexion:<id>#campo".`,
        );
      }
      const [, connectionId, campo] = m;

      const { rows } = await scope.query<{ credentials_encrypted: string | null; status: string }>(
        `select credentials_encrypted, status
           from public.connections
          where workspace_id = $1 and id = $2`,
        [ws, connectionId],
      );
      const fila = rows[0];
      if (!fila) throw new Error(`No existe la conexión ${connectionId} en este espacio.`);
      if (!fila.credentials_encrypted) {
        throw new Error(`La conexión ${connectionId} no tiene credenciales guardadas.`);
      }

      const clave = leerClave(opciones.encryptionKey ?? process.env['ENCRYPTION_KEY']);
      const claro = descifrar(fila.credentials_encrypted, clave);
      if (!campo) return claro;

      const objeto = JSON.parse(claro) as Record<string, unknown>;
      const valor = objeto[campo];
      if (typeof valor !== 'string') {
        throw new Error(`La conexión ${connectionId} no tiene el campo "${campo}".`);
      }
      return valor;
    },
  };
}
