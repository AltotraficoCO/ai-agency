/**
 * Plantillas (HSM).
 *
 * Una plantilla rechazada deja al cliente sin poder reenganchar conversaciones
 * fuera de la ventana de 24h, y el ciclo de revisión de Meta tarda horas. Por
 * eso el validador previo es tan importante como la sincronización: avisar
 * antes de enviar a aprobación cuesta un segundo; que la rechacen cuesta un día.
 */
import type { ClienteWhatsApp } from "./client.js";
import type { MetaTemplate, TemplateCategory, TemplateStatus } from "./types.js";

export type PlantillaNormalizada = {
  id: string;
  nombre: string;
  idioma: string;
  estado: TemplateStatus;
  categoria: TemplateCategory;
  /** Nombres o índices de las variables del cuerpo, en orden. */
  variables: string[];
  motivoRechazo?: string;
  calidad?: string;
  /** ¿Se puede usar ahora mismo para enviar? */
  utilizable: boolean;
};

// --- Sincronización -----------------------------------------------------------

/**
 * Trae todas las plantillas de la WABA. Pagina hasta el final porque un
 * cliente con muchas plantillas vería estados desactualizados a medias, y una
 * plantilla "aprobada" que en realidad está pausada rompe el envío en caliente.
 */
export async function sincronizarPlantillas(
  api: ClienteWhatsApp,
  wabaId: string,
  opciones: { maxPaginas?: number } = {},
): Promise<PlantillaNormalizada[]> {
  const maxPaginas = opciones.maxPaginas ?? 20;
  const salida: PlantillaNormalizada[] = [];
  let despues: string | undefined;

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const respuesta = await api.listarPlantillas({
      wabaId,
      limite: 100,
      ...(despues ? { despues } : {}),
    });
    for (const cruda of respuesta.data ?? []) {
      const normalizada = normalizarPlantilla(cruda);
      if (normalizada) salida.push(normalizada);
    }
    despues = respuesta.paging?.cursors?.after;
    if (!despues || !(respuesta.data ?? []).length) break;
  }

  return salida;
}

export function normalizarPlantilla(cruda: MetaTemplate): PlantillaNormalizada | null {
  if (!cruda.name || !cruda.id) return null;
  const estado = cruda.status ?? "PENDING";
  const cuerpo = cruda.components?.find((c) => (c.type ?? "").toUpperCase() === "BODY");
  return {
    id: cruda.id,
    nombre: cruda.name,
    idioma: cruda.language ?? "es",
    estado,
    categoria: cruda.category ?? "UTILITY",
    variables: extraerVariables(cuerpo?.text ?? ""),
    ...(cruda.rejected_reason ? { motivoRechazo: cruda.rejected_reason } : {}),
    ...(cruda.quality_score?.score ? { calidad: cruda.quality_score.score } : {}),
    // PAUSED sigue existiendo pero Meta rechaza los envíos: no es utilizable.
    utilizable: estado === "APPROVED",
  };
}

/** Variables posicionales `{{1}}` o con nombre `{{nombre}}`, en orden de aparición. */
export function extraerVariables(texto: string): string[] {
  const encontradas: string[] = [];
  for (const coincidencia of texto.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
    const nombre = coincidencia[1];
    if (nombre !== undefined) encontradas.push(nombre);
  }
  return encontradas;
}

// --- Validador previo ---------------------------------------------------------

export type Severidad = "error" | "aviso";

export type Hallazgo = {
  severidad: Severidad;
  campo: string;
  /** Redactado en español: la interfaz lo muestra tal cual. */
  mensaje: string;
};

export type BorradorPlantilla = {
  nombre: string;
  idioma: string;
  categoria: TemplateCategory;
  encabezado?: { tipo: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"; texto?: string };
  cuerpo: string;
  pie?: string;
  botones?: { tipo: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; texto: string; valor?: string }[];
  /** Valores de ejemplo para cada variable del cuerpo. Meta los exige. */
  ejemplos?: string[];
};

/** Límites publicados por Meta. Superarlos es rechazo automático. */
export const LIMITES = {
  nombre: 512,
  encabezadoTexto: 60,
  cuerpo: 1024,
  pie: 60,
  botonTexto: 25,
  botonesMax: 10,
  variablesEncabezado: 1,
} as const;

export type ResultadoValidacion = {
  ok: boolean;
  hallazgos: Hallazgo[];
};

/**
 * Revisa un borrador ANTES de mandarlo a aprobación.
 * `error` bloquea el envío; `aviso` no bloquea pero sube mucho el riesgo de
 * rechazo, que es lo que de verdad duele: una plantilla en revisión no se
 * puede usar y el cliente se queda sin reenganche mientras tanto.
 */
export function validarBorrador(borrador: BorradorPlantilla): ResultadoValidacion {
  const hallazgos: Hallazgo[] = [];
  const error = (campo: string, mensaje: string) =>
    hallazgos.push({ severidad: "error", campo, mensaje });
  const aviso = (campo: string, mensaje: string) =>
    hallazgos.push({ severidad: "aviso", campo, mensaje });

  // --- Nombre ---------------------------------------------------------------
  if (!borrador.nombre) {
    error("nombre", "La plantilla necesita un nombre.");
  } else {
    if (!/^[a-z0-9_]+$/.test(borrador.nombre)) {
      error(
        "nombre",
        "El nombre solo puede llevar minúsculas, números y guiones bajos. Meta rechaza mayúsculas, tildes y espacios.",
      );
    }
    if (borrador.nombre.length > LIMITES.nombre) {
      error("nombre", `El nombre supera los ${LIMITES.nombre} caracteres.`);
    }
  }

  if (!borrador.idioma) {
    error("idioma", "Falta el idioma de la plantilla (por ejemplo, es o es_MX).");
  }

  // --- Cuerpo ---------------------------------------------------------------
  const cuerpo = borrador.cuerpo ?? "";
  if (!cuerpo.trim()) {
    error("cuerpo", "El cuerpo de la plantilla no puede estar vacío.");
  }
  if (cuerpo.length > LIMITES.cuerpo) {
    error(
      "cuerpo",
      `El cuerpo tiene ${cuerpo.length} caracteres y el máximo es ${LIMITES.cuerpo}.`,
    );
  }

  const variables = extraerVariables(cuerpo);
  const posicionales = variables.every((v) => /^\d+$/.test(v));
  const conNombre = variables.every((v) => /^[a-z][a-z0-9_]*$/i.test(v));

  if (variables.length > 0 && !posicionales && !conNombre) {
    error(
      "cuerpo",
      "Las variables deben ser todas posicionales ({{1}}, {{2}}) o todas con nombre. Meta no admite mezclarlas.",
    );
  }

  if (posicionales && variables.length > 0) {
    const numeros = variables.map(Number);
    const esperado = numeros.map((_, i) => i + 1);
    if (numeros.join(",") !== esperado.join(",")) {
      error(
        "cuerpo",
        `Las variables deben ir numeradas y en orden desde {{1}}. Encontramos: ${variables.map((v) => `{{${v}}}`).join(", ")}.`,
      );
    }
  }

  if (borrador.ejemplos && borrador.ejemplos.length !== variables.length) {
    error(
      "ejemplos",
      `La plantilla tiene ${variables.length} variable(s) y ${borrador.ejemplos.length} ejemplo(s). Meta exige un ejemplo por variable.`,
    );
  }
  if (variables.length > 0 && !borrador.ejemplos) {
    aviso(
      "ejemplos",
      "Falta un valor de ejemplo para cada variable. Sin ejemplos, Meta suele rechazar la plantilla.",
    );
  }

  // Meta rechaza plantillas que son solo una variable, o que empiezan o
  // terminan con una: no puede evaluar el contenido real.
  const sinVariables = cuerpo.replace(/\{\{[^}]+\}\}/g, "").trim();
  if (variables.length > 0 && sinVariables.length === 0) {
    error("cuerpo", "El cuerpo no puede ser solo variables: Meta necesita texto fijo que revisar.");
  }
  if (/^\s*\{\{/.test(cuerpo) || /\}\}\s*$/.test(cuerpo)) {
    aviso(
      "cuerpo",
      "El cuerpo empieza o termina con una variable. Meta suele rechazarlo; añade texto fijo antes o después.",
    );
  }
  if (/\}\}\s*\{\{/.test(cuerpo)) {
    aviso("cuerpo", "Hay dos variables seguidas sin texto entre medias. Meta suele rechazarlo.");
  }

  // --- Encabezado -----------------------------------------------------------
  if (borrador.encabezado?.tipo === "TEXT") {
    const texto = borrador.encabezado.texto ?? "";
    if (!texto.trim()) error("encabezado", "El encabezado de texto está vacío.");
    if (texto.length > LIMITES.encabezadoTexto) {
      error(
        "encabezado",
        `El encabezado tiene ${texto.length} caracteres y el máximo es ${LIMITES.encabezadoTexto}.`,
      );
    }
    if (extraerVariables(texto).length > LIMITES.variablesEncabezado) {
      error("encabezado", "El encabezado admite como mucho una variable.");
    }
    if (/\n/.test(texto)) error("encabezado", "El encabezado no admite saltos de línea.");
  }

  // --- Pie ------------------------------------------------------------------
  if (borrador.pie) {
    if (borrador.pie.length > LIMITES.pie) {
      error("pie", `El pie tiene ${borrador.pie.length} caracteres y el máximo es ${LIMITES.pie}.`);
    }
    if (extraerVariables(borrador.pie).length > 0) {
      error("pie", "El pie no admite variables.");
    }
  }

  // --- Botones --------------------------------------------------------------
  const botones = borrador.botones ?? [];
  if (botones.length > LIMITES.botonesMax) {
    error("botones", `Como mucho ${LIMITES.botonesMax} botones; hay ${botones.length}.`);
  }
  for (const [i, boton] of botones.entries()) {
    if (boton.texto.length > LIMITES.botonTexto) {
      error(`botones[${i}]`, `El texto del botón supera los ${LIMITES.botonTexto} caracteres.`);
    }
    if (boton.tipo === "URL" && !boton.valor) {
      error(`botones[${i}]`, "El botón de enlace necesita una URL.");
    }
    if (boton.tipo === "PHONE_NUMBER" && !boton.valor) {
      error(`botones[${i}]`, "El botón de llamada necesita un número de teléfono.");
    }
  }

  // --- Categoría ------------------------------------------------------------
  hallazgos.push(...revisarCategoria(borrador, cuerpo));

  return { ok: !hallazgos.some((h) => h.severidad === "error"), hallazgos };
}

/**
 * Meta RECATEGORIZA sola: si una plantilla enviada como UTILITY suena
 * promocional, la pasa a MARKETING y el precio cambia (y deja de poder
 * enviarse en algunos casos). Avisar antes evita una factura sorpresa.
 */
const SEÑALES_MARKETING = [
  "descuento",
  "promoción",
  "promocion",
  "oferta",
  "rebaja",
  "cupón",
  "cupon",
  "gratis",
  "última oportunidad",
  "ultima oportunidad",
  "aprovecha",
  "compra ya",
  "novedades",
];

function revisarCategoria(borrador: BorradorPlantilla, cuerpo: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const texto = cuerpo.toLowerCase();
  const señales = SEÑALES_MARKETING.filter((s) => texto.includes(s));

  if (borrador.categoria === "UTILITY" && señales.length > 0) {
    hallazgos.push({
      severidad: "aviso",
      campo: "categoria",
      mensaje: `El texto parece promocional (${señales.join(", ")}). Meta puede recategorizarla como MARKETING, que se cobra distinto.`,
    });
  }

  if (borrador.categoria === "AUTHENTICATION") {
    if (!/\{\{\s*1\s*\}\}/.test(cuerpo)) {
      hallazgos.push({
        severidad: "error",
        campo: "categoria",
        mensaje: "Una plantilla de autenticación debe incluir la variable {{1}} con el código.",
      });
    }
    if ((borrador.botones ?? []).length === 0) {
      hallazgos.push({
        severidad: "aviso",
        campo: "botones",
        mensaje: "Las plantillas de autenticación suelen necesitar un botón para copiar el código.",
      });
    }
  }

  return hallazgos;
}

/**
 * Comprueba que los valores que se van a enviar encajan con la plantilla
 * aprobada. Evita el error 132000, que Meta devuelve en el momento del envío
 * y que en la bandeja aparece como "no se pudo enviar" sin más explicación.
 */
export function validarEnvio(input: {
  plantilla: PlantillaNormalizada;
  valores: readonly string[];
}): ResultadoValidacion {
  const hallazgos: Hallazgo[] = [];
  if (!input.plantilla.utilizable) {
    hallazgos.push({
      severidad: "error",
      campo: "plantilla",
      mensaje: `La plantilla «${input.plantilla.nombre}» no está aprobada (estado: ${input.plantilla.estado}).`,
    });
  }
  if (input.valores.length !== input.plantilla.variables.length) {
    hallazgos.push({
      severidad: "error",
      campo: "valores",
      mensaje: `La plantilla espera ${input.plantilla.variables.length} valor(es) y se enviaron ${input.valores.length}.`,
    });
  }
  for (const [i, valor] of input.valores.entries()) {
    // Meta rechaza saltos de línea, tabulaciones y más de 4 espacios seguidos.
    if (/[\n\t]/.test(valor) || /\s{5,}/.test(valor)) {
      hallazgos.push({
        severidad: "error",
        campo: `valores[${i}]`,
        mensaje: "Los valores de una plantilla no admiten saltos de línea ni espacios repetidos.",
      });
    }
  }
  return { ok: !hallazgos.some((h) => h.severidad === "error"), hallazgos };
}
