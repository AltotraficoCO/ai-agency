/**
 * Las palabras de cada agente por encargo: lo que dice mientras trabaja, de qué
 * depende, sus ejemplos. Solo datos, sin React.
 */

const FOTO_WEBMASTER = "/agentes/webmaster-plastilina.webp";

/**
 * Lo que cambia de un agente por encargo a otro.
 *
 * La pantalla es la misma —historial, encargos, aprobaciones, registro de
 * trabajo en vivo— porque la forma de trabajar es la misma. Lo que no puede ser
 * igual son las palabras: a un agente de publicidad no se le dice «conecta tu
 * sitio web», y sus ejemplos no son cambiar el pie de página.
 */
export type OficioEncargos = {
  readonly foto: string;
  /** Lo que se lee mientras trabaja: «Trabajando en tu web…». */
  readonly trabajando: string;
  /** De qué depende para poder trabajar. */
  readonly conexion: {
    /** Cómo se nombra lo conectado: «Trabaja en misitio.com». */
    readonly conectado: (nombre: string) => string;
    readonly sinConectar: string;
    readonly aviso: (nombreAgente: string) => string;
    readonly ctaTexto: string;
    readonly ctaHref: string;
    /** Si sin ello no puede hacer absolutamente nada. */
    readonly bloquea: boolean;
  };
  readonly ejemplos: readonly string[];
  readonly placeholder: (nombreAgente: string) => string;
  readonly invitacion: string;
};

export const OFICIO_WEBMASTER: OficioEncargos = {
  foto: FOTO_WEBMASTER,
  trabajando: "Trabajando en tu web…",
  conexion: {
    conectado: (nombre) => `Trabaja en ${nombre}`,
    sinConectar: "Sin sitio conectado",
    aviso: (agente) => `Conecta tu sitio para que ${agente} pueda hacer cambios en él.`,
    ctaTexto: "Conectar mi sitio",
    ctaHref: "/ajustes/sitio",
    // Sin WordPress no hay nada que tocar: mejor decirlo antes de encargar.
    bloquea: true,
  },
  ejemplos: [
    "Cambia el teléfono del pie de página por 300 123 4567",
    "Añade un enlace a Instagram en el pie de página",
    "Crea una página de contacto con un formulario",
    "Revisa si hay plugins sin actualizar",
    "Mide la velocidad de mi web y dime qué la hace lenta",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} cambie en tu sitio?`,
  invitacion:
    "Lo hace él mismo en tu sitio, guarda una copia antes y te pide permiso en lo delicado. Verás cada paso mientras trabaja.",
};


export const OFICIO_DISENADOR: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Dibujando…",
  conexion: {
    conectado: (nombre) => `Publica en ${nombre}`,
    sinConectar: "Sin sitio conectado",
    aviso: (agente) =>
      `Conecta tu sitio para que ${agente} tome los colores de tu marca y pueda publicar lo que dibuje. Sin él, igual te entrega las imágenes.`,
    ctaTexto: "Conectar mi sitio",
    ctaHref: "/ajustes/sitio",
    // Sin sitio dibuja igual: solo no puede publicar ni copiar la marca.
    bloquea: false,
  },
  ejemplos: [
    "Una portada para el artículo de esta semana",
    "Tres imágenes para redes sobre nuestra promoción",
    "Un banner para la página de inicio",
    "Rehaz esta imagen con los colores de la marca",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} dibuje?`,
  invitacion:
    "Dibuja con la identidad de tu sitio y te enseña el resultado antes de publicar nada.",
};

export const OFICIO_ADMINISTRATIVO: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Revisando tus cuentas…",
  conexion: {
    conectado: (nombre) => `Trabaja sobre ${nombre}`,
    sinConectar: "Sin contabilidad conectada",
    aviso: (agente) => `Conecta tu sistema de facturación para que ${agente} pueda ver tu cartera y tus facturas.`,
    ctaTexto: "Conectar contabilidad",
    ctaHref: "/ajustes/contabilidad",
    bloquea: true,
  },
  ejemplos: [
    "¿Qué facturas vencen esta semana?",
    "Recuérdale el pago a quien lleva más de 30 días",
    "Prepara la factura de este mes para el cliente X",
    "¿Cuánto tengo por cobrar?",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} gestione?`,
  invitacion:
    "Cartera, facturas, pagos y recordatorios. Emitir o cobrar siempre pasa por tu aprobación.",
};

export const OFICIO_REPORTES: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Preparando el informe…",
  conexion: {
    conectado: (nombre) => `Lee ${nombre}`,
    sinConectar: "Sin contabilidad conectada",
    aviso: (agente) => `Conecta tu sistema de facturación para que ${agente} tenga cifras reales que contarte.`,
    ctaTexto: "Conectar contabilidad",
    ctaHref: "/ajustes/contabilidad",
    bloquea: true,
  },
  ejemplos: [
    "¿Cómo vamos este mes?",
    "Dame el informe del negocio en una página",
    "¿Quién me debe más y desde cuándo?",
    "Compara las ventas de este mes con el anterior",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} te cuente?`,
  invitacion: "Solo lee. Te explica el negocio en una página, con las cifras de tu contabilidad.",
};

/**
 * Las palabras de cada oficio, por su slug del catálogo. Se resuelve AQUÍ, en
 * el navegador: un oficio lleva funciones dentro y del servidor solo puede
 * viajar el nombre.
 */
export const OFICIOS: Record<string, OficioEncargos> = {};

export const OFICIO_MARKETING: OficioEncargos = {
  foto: "/agentes/marketing-plastilina.webp",
  trabajando: "Revisando tus campañas…",
  conexion: {
    conectado: (nombre) => `Mira tus cuentas de ${nombre}`,
    sinConectar: "Sin plataformas conectadas",
    aviso: (agente) =>
      `Conecta Google Ads, Facebook o TikTok para que ${agente} pueda ver tus campañas. Mientras tanto puede responder con lo que sepa de tu negocio.`,
    ctaTexto: "Conectar mis plataformas",
    ctaHref: "/ajustes/canales",
    // Sin plataformas igual puede mirar y explicar qué le falta: encargar no
    // se bloquea, porque una respuesta honesta vale más que un botón apagado.
    bloquea: false,
  },
  ejemplos: [
    "¿Cómo van mis campañas esta semana?",
    "¿En qué estoy tirando el dinero?",
    "Pausa la campaña que no trae clientes",
    "Súbele el presupuesto a la que mejor funciona",
  ],
  placeholder: (agente) => `¿Qué quieres que revise ${agente}?`,
  invitacion:
    "Mira lo que gastas en anuncios, te dice qué está trayendo clientes y qué no, y te propone los cambios. Nunca mueve tu dinero sin que lo apruebes.",
};

Object.assign(OFICIOS, {
  webmaster: OFICIO_WEBMASTER,
  disenador: OFICIO_DISENADOR,
  marketing: OFICIO_MARKETING,
  administrativo: OFICIO_ADMINISTRATIVO,
  reportes: OFICIO_REPORTES,
});
