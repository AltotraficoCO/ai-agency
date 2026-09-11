import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se publican en TypeScript sin compilar: Next los
  // transpila con el resto de la aplicación.
  transpilePackages: [
    "@strappy/ui",
    "@strappy/core",
    "@strappy/db",
    "@strappy/tools",
    "@strappy/rag",
    "@strappy/whatsapp",
    "@strappy/webmaster",
  ],

  // `pg` carga sus dialectos con require dinámico; empaquetarlo lo rompe. Los
  // lectores de documentos de Conocimiento, igual: `unpdf` usa `import.meta`
  // de una forma que webpack no admite al empaquetar, y `mammoth` y
  // `read-excel-file` cargan sus dependencias en tiempo de ejecución.
  serverExternalPackages: ["pg", "unpdf", "mammoth", "read-excel-file"],

  /**
   * Por qué webpack y no Turbopack.
   *
   * Los paquetes del monorepo importan con extensión `.js` apuntando a archivos
   * `.ts` (`export * from "./ports.js"`), que es lo que exige el `moduleResolution`
   * de TypeScript en ESM y lo que ya está escrito en `core`, `tools`, `rag` y `db`.
   * Turbopack no reescribe esa extensión y falla al resolver los 47 módulos;
   * webpack sí, con `extensionAlias`. Volver a Turbopack es un cambio de una
   * línea el día que soporte `extensionAlias`, y entonces esta nota sobra.
   */
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
