/**
 * Cifrado de credenciales del sitio (AES-256-GCM).
 *
 * Portado del proyecto anterior (`apps/web/src/lib/crypto.ts`), con un cambio
 * que no es cosmético: aquí la clave maestra es OBLIGATORIA. El original caía
 * a `"dev-only"` cuando faltaba la variable de entorno, y eso significa que un
 * despliegue mal configurado cifra todas las contraseñas de aplicación de
 * todos los clientes con una clave que está escrita en el repositorio.
 *
 * El sobre es `iv(12) || tag(16) || ciphertext`, en base64. `keyVersion` viaja
 * fuera (la columna `connections.key_version` de la base de datos) para poder
 * rotar la clave maestra sin descifrar todo de golpe.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoConfigError";
  }
}

/** Deriva la clave de 32 bytes. Se acepta cualquier secreto largo, no solo hex. */
export function deriveKey(secret: string): Buffer {
  if (secret.length < 16) {
    throw new CryptoConfigError(
      "La clave maestra de cifrado tiene menos de 16 caracteres. Genera una con `openssl rand -base64 32`.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Lee la clave del entorno. Sin ella no se cifra ni se descifra: se falla. */
export function masterKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new CryptoConfigError(
      "Falta APP_ENCRYPTION_KEY. Sin clave maestra no se pueden leer las credenciales de los sitios.",
    );
  }
  return deriveKey(secret);
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 29) throw new Error("Sobre cifrado corrupto: faltan iv o tag.");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Cifra/descifra el JSON de credenciales de un sitio. */
export function encryptJson(value: unknown, key: Buffer): string {
  return encrypt(JSON.stringify(value), key);
}

export function decryptJson<T>(payload: string, key: Buffer): T {
  return JSON.parse(decrypt(payload, key)) as T;
}
