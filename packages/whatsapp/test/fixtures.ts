import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Respuestas grabadas de Meta. Se leen como TEXTO CRUDO a propósito: la firma
 * del webhook se calcula sobre los bytes exactos, y reserializar el JSON
 * cambiaría espacios y orden de claves invalidando la firma.
 */
export function crudo(nombre: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url)), "utf8");
}

export function fixture<T = unknown>(nombre: string): T {
  return JSON.parse(crudo(nombre)) as T;
}
