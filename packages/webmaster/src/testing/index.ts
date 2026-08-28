/**
 * Dobles para pruebas, publicados a propósito bajo `@strappy/webmaster/testing`.
 *
 * Van en un punto de entrada aparte para que `ai/test` no entre en el paquete
 * de producción. El doble de la REST API de WordPress no es solo del test de
 * este paquete: el worker lo necesita para probar su consumidor de punta a
 * punta y la web lo necesitará para la pantalla de aprobaciones. Tenerlo una
 * sola vez evita que existan dos WordPress de mentira que no coincidan.
 */
export * from "./wordpress.js";
export * from "./conector.js";
export * from "./dobles.js";
