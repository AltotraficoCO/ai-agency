/**
 * Vigilancia proactiva del sitio.
 *
 * Dos piezas: `decidir.ts`, que es puro y contiene la regla difícil (cuándo
 * merece la pena avisar a alguien), y `chequeo.ts`, que hace las peticiones.
 * El worker las junta en su consumidor; la web solo lee los avisos.
 */
export {
  clasificarConsola,
  decidirAvisos,
  tocaComprobacionDiaria,
  type Aviso,
  type ConsolaClasificada,
  type Chequeo,
  type Decision,
  type EstadoVigilancia,
  type MedidaCertificado,
  type MedidaConsola,
  type MedidaPlugins,
  type MedidaPortada,
  type MedidaRest,
  type SeveridadAviso,
} from "./decidir.js";
export { comprobarSitio, esMasNueva, medirCertificado, type OpcionesChequeo } from "./chequeo.js";
