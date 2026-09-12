/**
 * Qué se avisa y qué se calla.
 *
 * Módulo puro: sin red, sin reloj propio y sin base de datos. Recibe el estado
 * anterior del sitio y la última comprobación, y devuelve el estado nuevo más
 * los avisos que hay que mandar. Así la regla difícil —cuándo merece la pena
 * molestar a alguien— se prueba sin levantar nada.
 *
 * Las tres reglas que lo gobiernan:
 *
 *  1. Se avisa cuando el estado CAMBIA. Un sitio que lleva dos horas caído no
 *     genera ocho avisos: genera uno cuando se cae y otro cuando vuelve.
 *  2. Una caída se confirma con una segunda comprobación separada en el tiempo.
 *     Un fallo aislado es un fallo de red, no una caída, y avisar de cada uno
 *     enseña a la gente a ignorar los avisos.
 *  3. El texto lo lee el dueño del negocio: qué pasó, desde cuándo, qué
 *     significa para sus clientes y qué se puede hacer. Nunca «HTTP 502».
 */

// ---------------------------------------------------------------------------
// Lo que mide una comprobación
// ---------------------------------------------------------------------------

export type MedidaPortada = {
  readonly ok: boolean;
  /** Código que devolvió el sitio, o null si no llegó a responder. */
  readonly status: number | null;
  readonly ms: number | null;
  readonly error?: string;
};

export type MedidaRest = {
  /** La REST API de WordPress responde. */
  readonly ok: boolean;
  /** Las credenciales guardadas siguen sirviendo para escribir. */
  readonly credenciales: boolean;
  readonly error?: string;
};

export type MedidaCertificado = {
  readonly diasRestantes: number;
  /** ISO 8601. */
  readonly caducaEn: string;
  readonly emisor?: string;
  readonly error?: string;
};

export type MedidaPlugins = {
  readonly pendientes: number;
  readonly nombres: readonly string[];
};

export type MedidaConsola = {
  readonly errores: readonly string[];
};

/** Una ronda de comprobaciones. Las caras pueden faltar: no van en cada ronda. */
export type Chequeo = {
  /** ISO 8601. */
  readonly en: string;
  readonly portada: MedidaPortada;
  readonly rest?: MedidaRest;
  readonly certificado?: MedidaCertificado;
  readonly plugins?: MedidaPlugins;
  readonly consola?: MedidaConsola;
};

// ---------------------------------------------------------------------------
// Lo que se recuerda entre rondas
// ---------------------------------------------------------------------------

/**
 * Memoria de la vigilancia de un sitio. Se guarda tal cual como JSON; todo es
 * opcional para que un sitio nuevo empiece con `{}` sin migrar nada.
 */
export type EstadoVigilancia = {
  /** Caída ya confirmada y avisada. */
  readonly caido?: boolean;
  /** Primer fallo todavía sin confirmar. ISO 8601. */
  readonly sospechaDesde?: string;
  /** Desde cuándo está caído de verdad. ISO 8601. */
  readonly caidoDesde?: string;
  /** Las credenciales dejaron de servir y ya se avisó. */
  readonly credencialesMal?: boolean;
  /** Umbral de días del certificado que ya se avisó (15, 7, 3, 1 o 0). */
  readonly certAvisado?: number;
  /** Última vez que se avisó de plugins pendientes. ISO 8601. */
  readonly pluginsAvisadoEn?: string;
  /** Última vez que se avisó de errores en la página. ISO 8601. */
  readonly consolaAvisadaEn?: string;
  /** Cuándo se hizo por última vez cada comprobación cara. ISO 8601. */
  readonly certMedidoEn?: string;
  readonly pluginsMedidosEn?: string;
  readonly consolaMedidaEn?: string;
};

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

export type SeveridadAviso = "grave" | "aviso" | "bueno";

export type Aviso = {
  /**
   * Identifica el aviso concreto. Sirve para no mandarlo dos veces si la ronda
   * se repite: lleva dentro el momento del cambio, no el de la comprobación.
   */
  readonly clave: string;
  readonly severidad: SeveridadAviso;
  readonly titulo: string;
  readonly cuerpo: string;
  /** Qué se puede hacer. Null cuando no hay nada que proponer. */
  readonly propuesta: string | null;
};

export type Decision = {
  readonly estado: EstadoVigilancia;
  readonly avisos: readonly Aviso[];
};

/** Umbrales de aviso del certificado, en días. De mayor a menor. */
const UMBRALES_CERT = [15, 7, 3, 1] as const;

/** Cada cuánto se repite, como mucho, un aviso que no es un cambio de estado. */
const DIAS_ENTRE_RECORDATORIOS = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------

export function decidirAvisos(
  previo: EstadoVigilancia,
  chequeo: Chequeo,
  opciones: { readonly nombreSitio?: string } = {},
): Decision {
  const avisos: Aviso[] = [];
  let estado: EstadoVigilancia = { ...previo };
  const sitio = opciones.nombreSitio?.trim() || "tu web";

  // --- Caída y recuperación -------------------------------------------------
  if (!chequeo.portada.ok) {
    if (previo.caido) {
      // Sigue caído: silencio. Ya se avisó y repetirlo no añade nada.
    } else if (previo.sospechaDesde) {
      // Segundo fallo, separado en el tiempo del primero: ahora sí es una caída.
      const desde = previo.sospechaDesde;
      estado = { ...estado, caido: true, caidoDesde: desde, sospechaDesde: undefined };
      avisos.push(avisoCaida(sitio, chequeo.portada, desde));
    } else {
      // Primer fallo: puede ser un tropiezo de red. Se confirma en la siguiente.
      estado = { ...estado, sospechaDesde: chequeo.en };
    }
  } else {
    if (previo.caido) {
      avisos.push(avisoVuelta(sitio, previo.caidoDesde, chequeo.en));
    }
    estado = { ...estado, caido: false, caidoDesde: undefined, sospechaDesde: undefined };
  }

  // --- Credenciales ---------------------------------------------------------
  // Solo se juzgan si la REST API respondió: con el sitio caído, todo falla.
  if (chequeo.rest?.ok) {
    if (!chequeo.rest.credenciales && !previo.credencialesMal) {
      estado = { ...estado, credencialesMal: true };
      avisos.push(avisoCredenciales(sitio));
    } else if (chequeo.rest.credenciales && previo.credencialesMal) {
      estado = { ...estado, credencialesMal: false };
      avisos.push({
        clave: `credenciales-ok:${chequeo.en}`,
        severidad: "bueno",
        titulo: "Ya vuelvo a tener acceso a tu web",
        cuerpo: `Recuperé el acceso a ${sitio}. Puedo volver a hacer cambios cuando me los pidas.`,
        propuesta: null,
      });
    }
  }

  // --- Certificado ----------------------------------------------------------
  const cert = chequeo.certificado;
  if (cert && !cert.error) {
    estado = { ...estado, certMedidoEn: chequeo.en };
    const umbral = umbralDe(cert.diasRestantes);
    const yaAvisado = previo.certAvisado;
    if (umbral === null) {
      // Lejos de caducar: si se renovó, se rearma el aviso para la próxima vez.
      if (yaAvisado !== undefined) estado = { ...estado, certAvisado: undefined };
    } else if (yaAvisado === undefined || umbral < yaAvisado) {
      estado = { ...estado, certAvisado: umbral };
      avisos.push(avisoCertificado(sitio, cert));
    }
  }

  // --- Plugins pendientes ---------------------------------------------------
  if (chequeo.plugins) {
    estado = { ...estado, pluginsMedidosEn: chequeo.en };
    if (
      chequeo.plugins.pendientes > 0 &&
      tocaRecordar(previo.pluginsAvisadoEn, chequeo.en)
    ) {
      estado = { ...estado, pluginsAvisadoEn: chequeo.en };
      avisos.push(avisoPlugins(sitio, chequeo.plugins));
    }
  }

  // --- Errores en la página -------------------------------------------------
  if (chequeo.consola) {
    estado = { ...estado, consolaMedidaEn: chequeo.en };
    if (chequeo.consola.errores.length > 0 && tocaRecordar(previo.consolaAvisadaEn, chequeo.en)) {
      estado = { ...estado, consolaAvisadaEn: chequeo.en };
      avisos.push(avisoConsola(sitio, chequeo.consola));
    }
  }

  return { estado: limpiar(estado), avisos };
}

// ---------------------------------------------------------------------------
// Cuándo toca una comprobación cara
// ---------------------------------------------------------------------------

/**
 * Las comprobaciones caras no van en cada ronda: el certificado y los plugins
 * cambian de mes en mes, y abrir el navegador para leer la consola cuesta
 * memoria y segundos. Una vez al día basta y no gasta nada de crédito.
 */
export function tocaComprobacionDiaria(ultimaEn: string | undefined, ahora: string): boolean {
  if (!ultimaEn) return true;
  return diferenciaMs(ultimaEn, ahora) >= DIA_MS;
}

function tocaRecordar(ultimaEn: string | undefined, ahora: string): boolean {
  if (!ultimaEn) return true;
  return diferenciaMs(ultimaEn, ahora) >= DIAS_ENTRE_RECORDATORIOS * DIA_MS;
}

function diferenciaMs(desde: string, hasta: string): number {
  const a = Date.parse(desde);
  const b = Date.parse(hasta);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return b - a;
}

/**
 * El umbral al que pertenece un certificado: el MÁS PEQUEÑO que todavía lo
 * cubre. Con 6 días es el de 7, no el de 15; si devolviera el de 15, cruzar de
 * 14 a 6 días no volvería a avisar y el cliente se enteraría al vencer.
 */
function umbralDe(dias: number): number | null {
  if (dias <= 0) return 0;
  for (let i = UMBRALES_CERT.length - 1; i >= 0; i--) {
    const u = UMBRALES_CERT[i]!;
    if (dias <= u) return u;
  }
  return null;
}

/** Quita las claves en `undefined` para que el JSON guardado no crezca solo. */
function limpiar(estado: EstadoVigilancia): EstadoVigilancia {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(estado)) {
    if (v !== undefined) salida[k] = v;
  }
  return salida as EstadoVigilancia;
}

// ---------------------------------------------------------------------------
// Los textos. Los lee el dueño del negocio, no un técnico.
// ---------------------------------------------------------------------------

function avisoCaida(sitio: string, portada: MedidaPortada, desde: string): Aviso {
  const causa = causaDeCaida(portada);
  return {
    clave: `caido:${desde}`,
    severidad: "grave",
    titulo: `${sitio} no está abriendo`,
    cuerpo: [
      `Comprobé ${sitio} dos veces seguidas y no respondió: ahora mismo tus clientes no pueden verla.`,
      `Empezó ${enPalabras(desde)}.`,
      causa,
    ]
      .filter(Boolean)
      .join(" "),
    propuesta: propuestaDeCaida(portada),
  };
}

function causaDeCaida(portada: MedidaPortada): string {
  if (portada.status === null) {
    return "El servidor ni siquiera contestó, así que puede ser el hosting o el dominio.";
  }
  if (portada.status >= 500) return "El servidor contestó con un error interno.";
  if (portada.status === 404) return "La dirección responde, pero dice que la página no existe.";
  if (portada.status === 403) return "El servidor está rechazando las visitas.";
  return `El servidor contestó, pero con un error (${portada.status}).`;
}

function propuestaDeCaida(portada: MedidaPortada): string {
  if (portada.status === null || (portada.status >= 500 && portada.status !== 503)) {
    return "Esto suele ser cosa de tu proveedor de hosting: conviene escribirles con la hora en que empezó. Si prefieres, reviso el sitio en cuanto vuelva y te digo si quedó algo roto.";
  }
  if (portada.status === 503) {
    return "Suele pasar durante una actualización o con el servidor saturado. Si en unos minutos sigue igual, escribe a tu proveedor de hosting. Puedo revisarlo cuando me lo pidas.";
  }
  return "Puedo revisarlo y decirte qué está fallando: pídemelo y lo miro.";
}

function avisoVuelta(sitio: string, caidoDesde: string | undefined, ahora: string): Aviso {
  const duracion = caidoDesde ? duracionEnPalabras(diferenciaMs(caidoDesde, ahora)) : null;
  return {
    clave: `recuperado:${ahora}`,
    severidad: "bueno",
    titulo: `${sitio} volvió a funcionar`,
    cuerpo: duracion
      ? `Ya abre con normalidad. Estuvo sin abrir ${duracion}.`
      : "Ya abre con normalidad.",
    propuesta: "Si quieres, la reviso por dentro para confirmar que no quedó nada roto.",
  };
}

function avisoCredenciales(sitio: string): Aviso {
  return {
    clave: "credenciales",
    severidad: "aviso",
    titulo: `Perdí el acceso para trabajar en ${sitio}`,
    cuerpo:
      "Tu web abre bien para tus clientes, pero la contraseña que me diste ya no me deja entrar a hacer cambios. Suele pasar cuando se cambia la contraseña o se borra el acceso de la aplicación.",
    propuesta:
      "Vuelve a conectar tu web desde Ajustes y sigo trabajando donde lo dejé. Son dos minutos.",
  };
}

function avisoCertificado(sitio: string, cert: MedidaCertificado): Aviso {
  const caducado = cert.diasRestantes <= 0;
  return {
    clave: `certificado:${umbralDe(cert.diasRestantes) ?? "ok"}:${cert.caducaEn}`,
    severidad: caducado ? "grave" : "aviso",
    titulo: caducado
      ? `El candado de seguridad de ${sitio} está vencido`
      : `El candado de seguridad de ${sitio} vence en ${cert.diasRestantes} ${cert.diasRestantes === 1 ? "día" : "días"}`,
    cuerpo: caducado
      ? "El navegador de tus clientes les está mostrando un aviso rojo de sitio no seguro antes de dejarles entrar. Es de lo que más ventas cuesta."
      : `Cuando venza, el navegador enseñará a tus clientes un aviso de sitio no seguro antes de dejarles entrar. Vence el ${fechaCorta(cert.caducaEn)}.`,
    propuesta:
      "Casi todos los hostings lo renuevan solos: si no pasó, escribe a tu proveedor de hosting para que lo renueve.",
  };
}

function avisoPlugins(sitio: string, plugins: MedidaPlugins): Aviso {
  const n = plugins.pendientes;
  const lista = plugins.nombres.slice(0, 3).join(", ");
  return {
    clave: `plugins:${n}`,
    severidad: "aviso",
    titulo: `${n} ${n === 1 ? "complemento" : "complementos"} de ${sitio} sin actualizar`,
    cuerpo: [
      "Los complementos desactualizados son la vía por la que entra la mayoría de los ataques a un WordPress.",
      lista ? `Pendientes: ${lista}${plugins.nombres.length > 3 ? "…" : ""}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    propuesta: "Pídeme que los actualice y lo hago con copia de seguridad antes de tocar nada.",
  };
}

function avisoConsola(sitio: string, consola: MedidaConsola): Aviso {
  const n = consola.errores.length;
  return {
    clave: `consola:${n}`,
    severidad: "aviso",
    titulo: `Hay ${n === 1 ? "un fallo" : "fallos"} en la portada de ${sitio}`,
    cuerpo:
      "La página abre, pero algo dentro no está cargando bien. Suele verse como un botón que no responde, un formulario que no envía o una imagen que no aparece.",
    propuesta: "Pídeme que lo revise y te digo qué es y si se puede arreglar.",
  };
}

// ---------------------------------------------------------------------------

function enPalabras(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "hace un momento";
  const hora = fecha.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  return `a las ${hora}`;
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "pronto";
  return fecha.toLocaleDateString("es-CO", { day: "numeric", month: "long" });
}

function duracionEnPalabras(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "un momento";
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.round(horas / 24);
  return `${dias} ${dias === 1 ? "día" : "días"}`;
}
