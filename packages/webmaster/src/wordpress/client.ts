/**
 * Cliente de la REST API de WordPress con contraseñas de aplicación.
 *
 * Portado del proyecto anterior (`apps/worker/src/lib/wordpress.ts`), que ya
 * funciona en producción. Los cambios respecto al original son tres:
 *
 *  1. `fetch` es inyectable. Sin eso no se puede probar nada sin un WordPress
 *     de verdad delante, y un agente que solo se prueba a mano no se prueba.
 *  2. Tipos estrictos en las respuestas: el original leía `p.title?.rendered`
 *     sobre `any`, y un cambio de forma de la API se manifestaba como
 *     `undefined` en el contenido del cliente en vez de como un error.
 *  3. Los errores llevan siempre el cuerpo recortado de la respuesta: es lo
 *     único que permite entender un 403 de WordPress sin entrar al servidor.
 */
export type { WpCreds } from "../ports.js";
export { baseUrl, WpError, type WpClientOptions } from "./api/http.js";
export type { WpContent, WpContentDetalle, WpMedio, WpPlugin, TipoContenido } from "./api/tipos.js";
export * from "./api/lectura.js";
export * from "./api/mutaciones.js";
export * from "./api/elementor.js";
export * from "./api/plantillas.js";
export * from "./api/presentacion.js";
export * from "./api/verificacion.js";
