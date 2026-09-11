/**
 * El registro de trabajo del Webmaster.
 *
 * Mientras un encargo corre, la persona no ve el bucle de herramientas: ve
 * pasos contados para ella —«Leyendo el pie de página», «Instalando un
 * plugin»— que van cambiando de estado en vivo. Este módulo es puro (sin
 * red, sin base) y lo comparten el bucle que los emite, el worker que los
 * guarda y la web que los pinta, para que las tres partes hablen igual.
 *
 * Regla de seguridad: el detalle de un paso sale de la ENTRADA de la
 * herramienta, que puede traer credenciales. Solo se leen unas pocas claves
 * conocidas e inofensivas, y nunca una cuyo nombre huela a secreto.
 */

export type EstadoPaso = "en_curso" | "hecho" | "error" | "esperando";

export type PasoTrabajo = {
  /** Estable dentro del encargo (el `toolCallId`): sirve de clave y para fusionar. */
  readonly id: string;
  /** Slug de la herramienta, p. ej. `wp_leer_plantilla_elementor`. */
  readonly herramienta: string;
  readonly etiqueta: string;
  readonly estado: EstadoPaso;
  /** Una línea de contexto: qué página, qué plugin, el motivo del error. */
  readonly detalle: string | null;
  /** ISO 8601 del momento en que empezó el paso. */
  readonly en: string;
};

/** Qué está haciendo, en gerundio y para alguien que no sabe qué es un slug. */
const ETIQUETAS: Readonly<Record<string, string>> = {
  sitio_salud: "Revisando el estado del sitio",
  sitio_leer_diseno: "Estudiando el diseño del sitio",
  conector_salud: "Revisando el estado del sitio",
  verificar_http: "Comprobando que la página responde",

  wp_listar_contenido: "Revisando las páginas y entradas",
  wp_leer_contenido: "Leyendo una página",
  wp_editar_contenido: "Editando una página",
  wp_crear_contenido: "Creando una página",
  wp_borrar_contenido: "Enviando a la papelera",
  wp_restaurar_contenido: "Restaurando contenido",
  wp_crear_pagina_elementor: "Diseñando con Elementor",
  wp_enlazar_entrada_en_blog: "Enlazando la entrada en el blog",
  wp_listar_plugins: "Revisando los plugins",
  wp_instalar_plugin: "Instalando un plugin",
  wp_cambiar_plugin: "Activando o desactivando un plugin",
  wp_eliminar_plugin: "Eliminando un plugin",
  wp_leer_ajustes: "Leyendo los ajustes del sitio",
  wp_actualizar_ajustes: "Actualizando los ajustes del sitio",
  wp_listar_comentarios: "Revisando los comentarios",
  wp_moderar_comentario: "Moderando un comentario",
  wp_listar_usuarios: "Revisando los usuarios",
  wp_crear_usuario: "Creando un usuario",
  wp_cambiar_rol_usuario: "Cambiando el rol de un usuario",
  wp_crear_termino: "Creando una categoría o etiqueta",
  wp_subir_media: "Subiendo un archivo",
  wp_crear_header_global: "Creando el encabezado y el pie de página",
  wp_listar_plantillas_elementor: "Buscando el encabezado y el pie de página",
  wp_leer_plantilla_elementor: "Leyendo el encabezado o el pie de página",
  wp_editar_plantilla_elementor: "Editando el encabezado o el pie de página",

  conector_listar_paginas: "Revisando las páginas",
  conector_leer_pagina: "Leyendo una página",
  conector_leer_ajustes: "Leyendo los ajustes del sitio",
  conector_crear_pagina: "Creando una página",
  conector_actualizar_pagina: "Actualizando una página",
  conector_actualizar_seccion: "Actualizando una sección",
  conector_borrar_pagina: "Borrando una página",
  conector_actualizar_ajustes: "Actualizando los ajustes del sitio",
  conector_publicar: "Publicando el sitio",

  navegador_ver_pagina: "Mirando la página en el navegador",
  navegador_click: "Probando un botón de la página",
  navegador_escribir: "Escribiendo en un campo",
  navegador_leer: "Leyendo lo que se ve en la página",
  navegador_consola: "Buscando errores en la página",
  ver_referencia: "Mirando tu referencia",

  pedir_aprobacion: "Pidiéndote aprobación",
  preguntar_al_cliente: "Haciéndote una pregunta",
};

/**
 * Las herramientas que valen para páginas y para entradas. Llamar «página» a
 * una entrada confunde justo a quien intenta entender qué salió mal.
 */
const ETIQUETAS_DE_ENTRADA: Readonly<Record<string, string>> = {
  wp_leer_contenido: "Leyendo una entrada",
  wp_editar_contenido: "Editando una entrada",
  wp_crear_contenido: "Creando una entrada",
  wp_crear_pagina_elementor: "Diseñando una entrada con Elementor",
};

export function etiquetaDePaso(herramienta: string, entrada?: unknown): string {
  const tipo =
    entrada !== null && typeof entrada === "object" ? (entrada as Record<string, unknown>)["tipo"] : undefined;
  if (tipo === "post" && ETIQUETAS_DE_ENTRADA[herramienta]) return ETIQUETAS_DE_ENTRADA[herramienta];
  return ETIQUETAS[herramienta] ?? "Trabajando en tu sitio";
}

/** Claves de la entrada que dan contexto sin riesgo, en orden de preferencia. */
const CLAVES_DETALLE = [
  "nuevo_titulo",
  "titulo",
  "title",
  "nombre",
  "pregunta",
  "propuesta",
  "plugin",
  "slug",
  "texto",
  "etiqueta",
  "path",
  "ruta",
  "url",
  "tipo_plantilla",
] as const;

const PARECE_SECRETO = /pass|token|secret|clave|credencial|authorization|cookie/i;

export function recortar(texto: string, maximo = 90): string {
  const limpio = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio;
}

function detalleDe(objeto: Record<string, unknown>): string | null {
  for (const clave of CLAVES_DETALLE) {
    if (PARECE_SECRETO.test(clave)) continue;
    const valor = objeto[clave];
    if (typeof valor === "string" && valor.trim()) return recortar(valor);
    if (typeof valor === "number") return String(valor);
  }
  return null;
}

/** Una línea legible sacada de la entrada de la herramienta, o null si no hay nada seguro que decir. */
export function detalleDePaso(entrada: unknown): string | null {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) return null;
  const objeto = entrada as Record<string, unknown>;
  const directo = detalleDe(objeto);
  if (directo) return directo;
  // Las ediciones de plantillas llevan lo interesante un nivel más abajo.
  const cambio = objeto["cambio"];
  if (cambio && typeof cambio === "object" && !Array.isArray(cambio)) {
    return detalleDe(cambio as Record<string, unknown>);
  }
  return null;
}

export function esPasoTrabajo(valor: unknown): valor is PasoTrabajo {
  if (valor === null || typeof valor !== "object") return false;
  const p = valor as Record<string, unknown>;
  return (
    typeof p["id"] === "string" &&
    typeof p["herramienta"] === "string" &&
    typeof p["etiqueta"] === "string" &&
    (p["estado"] === "en_curso" || p["estado"] === "hecho" || p["estado"] === "error" || p["estado"] === "esperando") &&
    (p["detalle"] === null || typeof p["detalle"] === "string") &&
    typeof p["en"] === "string"
  );
}

/**
 * Añade un paso o actualiza el que ya tenía ese id, sin cambiar el orden.
 *
 * Se conserva el `en` original (cuándo empezó) y el detalle anterior si el
 * nuevo aviso no trae uno: «hecho» no tiene por qué repetir qué página era.
 */
export function fusionarPasos(existentes: readonly PasoTrabajo[], nuevo: PasoTrabajo): PasoTrabajo[] {
  const i = existentes.findIndex((p) => p.id === nuevo.id);
  if (i < 0) return [...existentes, nuevo];
  const previo = existentes[i]!;
  const copia = [...existentes];
  copia[i] = { ...nuevo, en: previo.en, detalle: nuevo.detalle ?? previo.detalle };
  return copia;
}

/**
 * Reconstruye el registro desde la conversación guardada de un encargo.
 *
 * Es el plan B para encargos anteriores al registro en vivo: sus pasos no se
 * guardaron, pero la conversación sí (mientras esperaban una aprobación).
 * No hay horas por paso, así que todos llevan la del encargo.
 */
export function pasosDesdeMensajes(mensajes: unknown, en: string): PasoTrabajo[] {
  if (!Array.isArray(mensajes)) return [];
  let pasos: PasoTrabajo[] = [];
  const herramientaDe = new Map<string, string>();
  const entradaDe = new Map<string, unknown>();

  for (const mensaje of mensajes) {
    const contenido = (mensaje as { content?: unknown } | null)?.content;
    if (!Array.isArray(contenido)) continue;
    for (const parte of contenido as Record<string, unknown>[]) {
      const tipo = parte?.["type"];
      const id = typeof parte?.["toolCallId"] === "string" ? (parte["toolCallId"] as string) : null;

      if (tipo === "tool-call" && id && typeof parte["toolName"] === "string") {
        const herramienta = parte["toolName"] as string;
        herramientaDe.set(id, herramienta);
        entradaDe.set(id, parte["input"]);
        pasos = fusionarPasos(pasos, {
          id,
          herramienta,
          etiqueta: etiquetaDePaso(herramienta, parte["input"]),
          // Sin resultado todavía: si la conversación se guardó así, esperaba un clic.
          estado: "esperando",
          detalle: detalleDePaso(parte["input"]),
          en,
        });
      } else if (tipo === "tool-result" && id) {
        const herramienta = herramientaDe.get(id) ?? String(parte["toolName"] ?? "");
        const salida = parte["output"] as { type?: unknown; value?: unknown } | undefined;
        const esError = typeof salida?.type === "string" && salida.type.startsWith("error");
        const valor = salida?.value as { requiere_aprobacion?: unknown } | undefined;
        pasos = fusionarPasos(pasos, {
          id,
          herramienta,
          etiqueta: etiquetaDePaso(herramienta, entradaDe.get(id)),
          estado: esError ? "error" : valor?.requiere_aprobacion === true ? "esperando" : "hecho",
          detalle: esError && typeof salida?.value === "string" ? recortar(salida.value) : null,
          en,
        });
      }
    }
  }
  return pasos;
}
