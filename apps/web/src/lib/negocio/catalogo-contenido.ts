/**
 * Lo que el cliente lee de cada agente antes de contratarlo.
 *
 * Esto es CONTENIDO DE PRODUCTO, no dato de cliente: los bullets que prometen
 * lo que sabe hacer, lo que necesita conectado y las preguntas del paso
 * «Personaliza». Vive aquí y no en `catalog_agents` porque habla de PANTALLAS
 * de esta aplicación —a dónde mandar al cliente a conectar cada cosa— y una
 * ruta de Next no tiene por qué vivir en Postgres.
 *
 * **Está ordenado por agente, y esa es la única razón de que este archivo
 * exista.** Antes eran tres diccionarios separados dentro del módulo que habla
 * con la base de datos, y en septiembre de 2026 los cinco agentes nuevos
 * nacieron seguidos sin bullets, sin conexiones y sin campos: para dar de alta
 * uno había que acordarse de editar tres sitios distintos, y nadie se acordaba.
 * Aquí, añadir el séptimo agente es añadir UN bloque, y basta mirar al vecino
 * para ver qué falta.
 *
 * Los tres campos son opcionales a propósito: un agente sin `capacidades`
 * escritas a mano cae en `capacidadesDeRespaldo`, que las saca de su ficha.
 *
 * Módulo puro, sin base de datos: no lleva `server-only` para que pueda leerlo
 * también una pantalla de cliente.
 */

/** Iconos con los que se pinta cada capacidad; el componente decide el dibujo. */
export type IconoCapacidad =
  | "web"
  | "plantilla"
  | "plugin"
  | "copia"
  | "aprobacion"
  | "mensaje"
  | "conocimiento"
  | "contacto"
  | "agenda"
  | "humano"
  | "redactar"
  | "segmentar"
  | "medir"
  | "imagen"
  | "velocidad"
  | "factura"
  | "dinero";

export type CapacidadAgente = {
  readonly icono: IconoCapacidad;
  readonly titulo: string;
  readonly detalle: string;
};

/**
 * Una conexión tal como se declara aquí, sin saber todavía si el espacio la
 * tiene lista: eso lo añade `catalogo.ts` al leer la base.
 */
export type ConexionDeclarada = {
  readonly clave: string;
  readonly nombre: string;
  readonly descripcion: string;
  /**
   * A dónde lleva «Conectar». Una página de la app, o una ruta `/api/.../conectar`
   * que arranca el permiso directamente y devuelve a quien pulsó a la página
   * desde la que lo hizo (ver `enlaceParaConectar`).
   */
  readonly ruta: string;
};

/**
 * El enlace de «Conectar» para una conexión, sabiendo desde qué página se pulsa.
 *
 * Las conexiones por permiso (Google Ads, Meta, TikTok) no tienen pantalla
 * propia: el enlace abre el consentimiento de la plataforma y, al volver, la
 * persona aterriza otra vez en `volver`, con el resultado. Así el asistente de
 * contratación no la manda a Ajustes a mitad de un paso a paso.
 */
export function enlaceParaConectar(conexion: ConexionDeclarada, volver: string): string {
  if (!conexion.ruta.startsWith("/api/")) return conexion.ruta;
  return `${conexion.ruta}?volver=${encodeURIComponent(volver)}`;
}

export type CampoPersonalizable = {
  readonly clave: string;
  readonly etiqueta: string;
  readonly ayuda: string;
  readonly tipo: "texto" | "parrafo" | "opcion";
  readonly opciones?: readonly { valor: string; etiqueta: string }[];
  readonly valorPorDefecto: string;
  /**
   * De dónde salen las opciones cuando hay una conexión que las conoce. Con
   * `cuentas_contabilidad`, si la contabilidad está conectada el campo pasa a
   * ser una lista con las cuentas reales; si no, se queda como texto. Pedir
   * a mano el nombre de una cuenta que el sistema ya sabe es pedir que lo
   * escriban mal.
   */
  readonly fuente?: "cuentas_contabilidad";
};

/**
 * Todo lo que se dice de un agente, junto.
 *
 * - `conexiones`: qué hace falta conectar antes de que sirva de algo.
 * - `capacidades`: qué sabe hacer, en palabras de negocio. Antes la ficha
 *   enseñaba `catalog_agents.required_tools`, que es lo que el MOTOR exige
 *   conectado y no lo que el agente hace; por eso el Webmaster salía con un
 *   único «Pasar a un humano».
 * - `campos`: los 3-5 que se preguntan al contratar. Todo lo demás —nombre
 *   legal, horario, ciudad, tono, políticas— se HEREDA de `company_profiles`,
 *   que se rellena una sola vez. Preguntar veinte campos por agente es lo que
 *   hace que nadie termine de configurar ninguno.
 */
export type ContenidoDeAgente = {
  readonly conexiones?: readonly ConexionDeclarada[];
  readonly capacidades?: readonly CapacidadAgente[];
  readonly campos?: readonly CampoPersonalizable[];
};

/** Por departamento, que es como se lee el catálogo en la pantalla. */
export const CONTENIDO_POR_AGENTE: Readonly<Record<string, ContenidoDeAgente>> = {
  // Webmaster — Desarrollo
  webmaster: {
    conexiones: [
      {
        clave: "sitio",
        nombre: "Tu sitio web",
        descripcion: "La dirección que tiene que vigilar y mantener.",
        ruta: "/ajustes/sitio",
      },
    ],
    capacidades: [
      {
        icono: "web",
        titulo: "Cambia textos, páginas y entradas",
        detalle: "Le pides el cambio y lo hace él mismo en tu WordPress.",
      },
      {
        icono: "plantilla",
        titulo: "Edita el encabezado y el pie de página",
        detalle: "Enlaces, botones y textos de tus plantillas de Elementor.",
      },
      {
        icono: "plugin",
        titulo: "Gestiona tus plugins",
        detalle: "Activa, desactiva o elimina los que le indiques.",
      },
      {
        icono: "copia",
        titulo: "Hace copia antes de tocar nada",
        detalle: "Y te pide tu visto bueno en los cambios que se ven.",
      },
    ],
    campos: [
      {
        clave: "sitio",
        etiqueta: "Dirección del sitio",
        ayuda: "La página que va a vigilar.",
        tipo: "texto",
        valorPorDefecto: "",
      },
      {
        clave: "frecuencia",
        etiqueta: "Cada cuánto revisa",
        ayuda: "Con qué frecuencia comprueba que todo sigue en pie.",
        tipo: "opcion",
        opciones: [
          { valor: "1h", etiqueta: "Cada hora" },
          { valor: "6h", etiqueta: "Cada 6 horas" },
          { valor: "24h", etiqueta: "Una vez al día" },
        ],
        valorPorDefecto: "6h",
      },
      {
        clave: "avisar_a",
        etiqueta: "A quién avisa si algo se cae",
        ayuda: "Correo al que manda la alerta.",
        tipo: "texto",
        valorPorDefecto: "",
      },
    ],
  },

  // Velocista — Desarrollo
  velocista: {
    conexiones: [
      {
        clave: "sitio",
        nombre: "Tu sitio web",
        descripcion: "La página que va a medir y acelerar.",
        ruta: "/ajustes/sitio",
      },
    ],
    capacidades: [
      {
        icono: "velocidad",
        titulo: "Mide cuánto tarda tu web en abrir",
        detalle: "En celular y en computador, con la misma vara con la que la mide Google.",
      },
      {
        icono: "medir",
        titulo: "Te dice qué la está frenando",
        detalle: "Imágenes pesadas, falta de caché o el servidor, dicho sin tecnicismos.",
      },
      {
        icono: "copia",
        titulo: "Arregla y te enseña el antes y el después",
        detalle: "Activa la caché con tu permiso, hace copia y vuelve a medir.",
      },
    ],
    campos: [
      {
        clave: "paginas_clave",
        etiqueta: "Qué páginas te importan más",
        ayuda: "Además de la portada. Una por línea: la de precios, la de contacto, la que más vende.",
        tipo: "parrafo",
        valorPorDefecto: "",
      },
      {
        clave: "puede_instalar",
        etiqueta: "Qué puede tocar en tu web",
        ayuda: "Instalar la caché es lo que más acelera, y siempre te lo pedirá antes.",
        tipo: "opcion",
        opciones: [
          { valor: "proponer", etiqueta: "Solo mirar y proponer" },
          { valor: "instalar", etiqueta: "Instalar la caché si hace falta" },
        ],
        valorPorDefecto: "proponer",
      },
    ],
  },

  // Disenador — Creativo
  disenador: {
    conexiones: [
      {
        clave: "sitio",
        nombre: "Tu sitio web",
        descripcion: "De ahí toma los colores de tu marca y ahí sube las imágenes.",
        ruta: "/ajustes/sitio",
      },
    ],
    capacidades: [
      {
        icono: "imagen",
        titulo: "Te hace las imágenes que hacen falta",
        detalle: "Portadas de artículos, piezas para tus redes y cabeceras de páginas.",
      },
      {
        icono: "plantilla",
        titulo: "Usa los colores reales de tu marca",
        detalle: "Los mide de tu propia web, para que no parezcan de plantilla.",
      },
      {
        icono: "aprobacion",
        titulo: "Te las enseña antes de subirlas",
        detalle: "Y nunca reemplaza una imagen tuya sin que se lo pidas.",
      },
    ],
    campos: [
      {
        clave: "estilo",
        etiqueta: "Cómo quieres tus imágenes",
        ayuda: "El aire que deben tener las piezas que haga.",
        tipo: "opcion",
        opciones: [
          { valor: "marca", etiqueta: "Como mi web" },
          { valor: "fotografico", etiqueta: "Fotográfico" },
          { valor: "ilustracion", etiqueta: "Ilustración" },
          { valor: "minimalista", etiqueta: "Minimalista" },
        ],
        valorPorDefecto: "marca",
      },
      {
        clave: "puede_publicar",
        etiqueta: "Qué hace con las imágenes",
        ayuda: "Subirlas al sitio te lo pedirá siempre antes.",
        tipo: "opcion",
        opciones: [
          { valor: "entregar", etiqueta: "Solo entregármelas" },
          { valor: "subir", etiqueta: "Subirlas a mi web cuando lo apruebe" },
        ],
        valorPorDefecto: "entregar",
      },
    ],
  },

  // Marketing — Marketing
  marketing: {
    conexiones: [
      {
        clave: "google_ads",
        nombre: "Google Ads",
        descripcion: "Para ver en qué se va tu inversión y proponerte cambios.",
        ruta: "/api/canales/anuncios/google_ads/conectar",
      },
      {
        clave: "meta_ads",
        nombre: "Facebook e Instagram",
        descripcion: "Tus campañas de Meta, con el mismo criterio que las de Google.",
        ruta: "/api/canales/anuncios/meta_ads/conectar",
      },
      {
        clave: "tiktok_ads",
        nombre: "TikTok",
        descripcion: "Tus campañas de TikTok, medidas con la misma vara que las demás.",
        ruta: "/api/canales/anuncios/tiktok_ads/conectar",
      },
      {
        clave: "analytics",
        nombre: "Google Analytics",
        descripcion: "Para saber qué hace la gente en tu web después de hacer clic.",
        ruta: "/ajustes/canales",
      },
      {
        clave: "conocimiento",
        nombre: "Conocimiento",
        descripcion: "Tu propuesta de valor y tus productos, para escribir con criterio.",
        ruta: "/conocimiento",
      },
    ],
    capacidades: [
      {
        icono: "medir",
        titulo: "Vigila en qué se va tu inversión",
        detalle: "Cuánto cuesta cada cliente que llega por Google, Facebook, Instagram y TikTok.",
      },
      {
        icono: "segmentar",
        titulo: "Encuentra el dinero que se pierde",
        detalle: "Te dice qué campaña gasta sin traer clientes y cuál es la que mejor funciona.",
      },
      {
        icono: "aprobacion",
        titulo: "Propone y espera tu visto bueno",
        detalle: "Nunca mueve tu presupuesto sin que tú lo apruebes con un botón.",
      },
    ],
    campos: [
      {
        clave: "objetivo",
        etiqueta: "Objetivo de las campañas",
        ayuda: "Qué quieres conseguir con lo que escriba.",
        tipo: "opcion",
        opciones: [
          { valor: "captar", etiqueta: "Captar clientes nuevos" },
          { valor: "recuperar", etiqueta: "Recuperar clientes inactivos" },
          { valor: "fidelizar", etiqueta: "Fidelizar a los que ya compran" },
        ],
        valorPorDefecto: "captar",
      },
      {
        clave: "tono",
        etiqueta: "Tono",
        ayuda: "Cómo suena tu marca cuando escribe.",
        tipo: "opcion",
        opciones: [
          { valor: "cercano", etiqueta: "Cercano" },
          { valor: "neutro", etiqueta: "Neutro" },
          { valor: "formal", etiqueta: "Formal" },
        ],
        valorPorDefecto: "cercano",
      },
      {
        clave: "no_mencionar",
        etiqueta: "Qué no debe mencionar nunca",
        ayuda: "Temas, promesas o competidores que quedan fuera.",
        tipo: "parrafo",
        valorPorDefecto: "",
      },
    ],
  },

  // Administrativo — Financiero
  administrativo: {
    conexiones: [
      {
        clave: "contabilidad",
        nombre: "Alegra",
        descripcion: "Tu sistema de facturación: de ahí saca quién te debe y cuánto entró.",
        ruta: "/ajustes/contabilidad",
      },
    ],
    capacidades: [
      {
        icono: "dinero",
        titulo: "Te dice cuánto te deben y desde cuándo",
        detalle: "Ordenado por lo que más pesa, no por fecha: primero lo grande y viejo.",
      },
      {
        icono: "factura",
        titulo: "Emite facturas y registra pagos",
        detalle: "En tu sistema de facturación, y nunca sin tu visto bueno.",
      },
      {
        icono: "mensaje",
        titulo: "Prepara los recordatorios de cobro",
        detalle: "Escritos para cobrar sin ofender a un cliente que quieres conservar.",
      },
    ],
    campos: [
      {
        clave: "dias_atraso",
        etiqueta: "Desde cuándo perseguir una factura",
        ayuda: "Cuántos días de atraso tiene que llevar para que empiece a insistir.",
        tipo: "opcion",
        opciones: [
          { valor: "8", etiqueta: "8 días" },
          { valor: "15", etiqueta: "15 días" },
          { valor: "30", etiqueta: "30 días" },
        ],
        valorPorDefecto: "15",
      },
      {
        clave: "puede_emitir",
        etiqueta: "Qué hace con las facturas",
        ayuda: "Puedes dejarlo solo preparando hasta que te fíes de él.",
        tipo: "opcion",
        opciones: [
          { valor: "preparar", etiqueta: "Solo las deja listas" },
          { valor: "emitir", etiqueta: "Las emite cuando lo apruebes" },
        ],
        valorPorDefecto: "preparar",
      },
      {
        clave: "impuesto",
        etiqueta: "Impuesto habitual",
        ayuda: "El que lleva la mayoría de tus facturas.",
        tipo: "opcion",
        opciones: [
          { valor: "iva19", etiqueta: "IVA 19%" },
          { valor: "exento", etiqueta: "Sin IVA" },
          { valor: "preguntar", etiqueta: "Que me pregunte cada vez" },
        ],
        valorPorDefecto: "preguntar",
      },
      {
        clave: "cuenta_cobro",
        etiqueta: "Dónde anota los pagos que entran",
        ayuda: "La cuenta o caja de tu facturación en la que registra un pago recibido. Si lo dejas vacío, te preguntará cada vez.",
        tipo: "texto",
        valorPorDefecto: "",
        fuente: "cuentas_contabilidad",
      },
    ],
  },

  // Reportes — Financiero
  reportes: {
    conexiones: [
      {
        clave: "contabilidad",
        nombre: "Alegra",
        descripcion: "De ahí saca lo que entró, lo que salió y lo que te deben.",
        ruta: "/ajustes/contabilidad",
      },
    ],
    capacidades: [
      {
        icono: "medir",
        titulo: "Cómo va el negocio, en una página",
        detalle: "Cuánto entró, cuánto salió, qué te deben y qué vence esta semana.",
      },
      {
        icono: "segmentar",
        titulo: "Lo compara con el periodo anterior",
        detalle: "Para que el dato sea una noticia y no un número suelto.",
      },
      {
        icono: "aprobacion",
        titulo: "Solo mira: nunca toca tu contabilidad",
        detalle: "No emite, no cobra y no modifica nada. Solo te cuenta.",
      },
    ],
    campos: [
      {
        clave: "dia_informe",
        etiqueta: "Qué día te lo cuenta",
        ayuda: "El día que quieres sentarte a mirar cómo va el negocio.",
        tipo: "opcion",
        opciones: [
          { valor: "lunes", etiqueta: "Los lunes" },
          { valor: "viernes", etiqueta: "Los viernes" },
          { valor: "dia1", etiqueta: "El día 1 de cada mes" },
        ],
        valorPorDefecto: "lunes",
      },
      {
        clave: "periodo",
        etiqueta: "Cuánto abarca el informe",
        ayuda: "Los días que mira hacia atrás cada vez.",
        tipo: "opcion",
        opciones: [
          { valor: "7", etiqueta: "La última semana" },
          { valor: "30", etiqueta: "El último mes" },
        ],
        valorPorDefecto: "7",
      },
    ],
  },};


/**
 * Los bullets de un agente que todavía no tiene los suyos escritos a mano.
 *
 * El diccionario de arriba es la versión buena: está escrita en el idioma del
 * dueño del negocio. Pero un agente nuevo que nadie recuerde añadir ahí salía
 * con la tarjeta pelada, y eso fue exactamente lo que pasó con los cinco
 * agentes que entraron en septiembre de 2026. Su ficha ya trae sus objetivos
 * (`spec_template.goals`), así que de ahí sale un respaldo digno: no es tan
 * bueno como el texto a mano, pero nunca deja una tarjeta vacía.
 */
export function capacidadesDeRespaldo(spec: unknown): readonly CapacidadAgente[] {
  const goals = (spec as { goals?: unknown } | null)?.goals;
  if (!Array.isArray(goals)) return [];
  return goals
    .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    .slice(0, 3)
    .map((g) => {
      const texto = g.trim();
      return {
        icono: "medir" as const,
        titulo: texto.charAt(0).toUpperCase() + texto.slice(1),
        detalle: "",
      };
    });
}

