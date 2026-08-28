/**
 * Pruebas de la aplicación web.
 *
 * Entorno de Node, sin DOM: lo que se prueba aquí es la lógica del meta-agente
 * —la transacción de publicación y la traducción de respuestas a borrador—, no
 * los componentes. Un test de render que comprueba que un botón dice «Enviar»
 * no ha atrapado nunca un fallo de este producto.
 */
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Vitest no carga `.env.local` —eso lo hace Next—. Sin `DATABASE_URL` las
 * pruebas que hablan con Postgres se saltarían siempre y nadie se enteraría de
 * que dejaron de ejecutarse.
 */
try {
  for (const linea of readFileSync(new URL("./.env.local", import.meta.url), "utf8").split("\n")) {
    const pareja = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (pareja?.[1] && process.env[pareja[1]] === undefined) {
      process.env[pareja[1]] = pareja[2]?.trim() ?? "";
    }
  }
} catch {
  // Sin archivo de entorno: las pruebas de base de datos se saltan solas.
}

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` solo existe para que Next falle si un módulo de servidor
      // acaba en el navegador. En Node no hay navegador del que protegerse.
      "server-only": fileURLToPath(new URL("./test/modulo-vacio.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts?(x)"],
  },
});
