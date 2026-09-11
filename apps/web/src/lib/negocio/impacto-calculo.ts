/**
 * El cálculo del «Impacto»: cuánto trabajo hicieron los agentes del negocio y
 * cuánto le habría costado ese trabajo a una persona.
 *
 * Es una ESTIMACIÓN y la pantalla lo dice. Para que sea honesta tiene que ser
 * explicable en una tabla: cada tipo de trabajo vale unos minutos fijos de una
 * persona, esos minutos se multiplican por la tarifa por hora que pone el
 * propio negocio, y se comparan con lo que de verdad se gastó en créditos.
 * Nada más. Toda la tabla vive aquí, en un solo sitio, y la pantalla la enseña
 * tal cual en «Cómo calculamos esto».
 *
 * Módulo puro: sin base de datos ni `server-only`, para poder probarlo y para
 * que la interfaz pueda leer la misma tabla que usa el servidor.
 */
import { diasDelRango, type RangoDias } from "./fechas";

// ── La tabla ────────────────────────────────────────────────────────────────

export type TipoTrabajo =
  | "diseno"
  | "contenido"
  | "plugins"
  | "copias"
  | "usuarios"
  | "ajustes"
  | "revision"
  | "campanas"
  | "otro";

/**
 * Minutos que le lleva a una persona cada tipo de trabajo, contados una vez por
 * encargo: editar el pie de página tres veces en el mismo encargo es un solo
 * «ajuste de diseño», no tres. Son cifras conservadoras a propósito: es mejor
 * que el negocio sienta que ahorró más de lo que dice la pantalla que menos.
 */
export const TRABAJOS: Readonly<
  Record<TipoTrabajo, { readonly etiqueta: string; readonly minutos: number; readonly ejemplo: string }>
> = {
  diseno: {
    etiqueta: "Diseño del sitio",
    minutos: 25,
    ejemplo: "Editar el encabezado, el pie de página o una plantilla",
  },
  contenido: {
    etiqueta: "Contenido",
    minutos: 15,
    ejemplo: "Crear o cambiar una página, una entrada o una imagen",
  },
  plugins: {
    etiqueta: "Plugins",
    minutos: 10,
    ejemplo: "Instalar, activar, desactivar o quitar un plugin",
  },
  copias: {
    etiqueta: "Copias y recuperación",
    minutos: 15,
    ejemplo: "Recuperar una página o volver a una versión anterior",
  },
  usuarios: {
    etiqueta: "Usuarios y comentarios",
    minutos: 10,
    ejemplo: "Crear un usuario, cambiar su papel o moderar comentarios",
  },
  ajustes: {
    etiqueta: "Ajustes del sitio",
    minutos: 15,
    ejemplo: "Cambiar ajustes generales de WordPress",
  },
  revision: {
    etiqueta: "Revisión y diagnóstico",
    minutos: 10,
    ejemplo: "Revisar el sitio, leer páginas o comprobar que todo responde",
  },
  campanas: {
    etiqueta: "Campañas",
    minutos: 45,
    ejemplo: "Preparar y enviar una campaña o sus mensajes",
  },
  otro: {
    etiqueta: "Otros encargos",
    minutos: 15,
    ejemplo: "Cualquier encargo que no encaje en lo anterior",
  },
};

/** Ningún encargo completado cuenta menos: abrir, entender y cerrar ya lleva ese rato. */
export const MINIMO_POR_ENCARGO = 15;

/** Ni más: un encargo que sumara más de 4 horas sería un error de la estimación, no un ahorro. */
export const MAXIMO_POR_ENCARGO = 240;

/** Herramientas que no son trabajo sino conversación con la persona. */
const HERRAMIENTAS_SIN_TRABAJO = new Set(["preguntar_al_cliente", "pedir_aprobacion", "ver_referencia"]);

/**
 * A qué tipo de trabajo corresponde una herramienta.
 *
 * Va por patrones del slug y no por una lista cerrada: el Webmaster gana
 * herramientas con el tiempo, y una nueva (`wp_editar_menu`) cae sola en su
 * sitio. El ORDEN importa: `wp_leer_plantilla_elementor` es una lectura, así
 * que las lecturas se miran antes que el diseño.
 */
export function tipoDeHerramienta(slug: string): TipoTrabajo | null {
  const s = slug.toLowerCase();
  if (HERRAMIENTAS_SIN_TRABAJO.has(s)) return null;
  if (/^navegador_|(^|_)(leer|listar|salud|verificar|consola)(_|$)/.test(s)) return "revision";
  if (/restaurar|backup|copia/.test(s)) return "copias";
  if (/plugin/.test(s)) return "plugins";
  if (/usuario|comentario/.test(s)) return "usuarios";
  if (/elementor|header|footer|plantilla|seccion|menu|tema/.test(s)) return "diseno";
  if (/ajustes/.test(s)) return "ajustes";
  if (/contenido|pagina|media|termino|publicar/.test(s)) return "contenido";
  if (/campana|correo|anuncio|segment|newsletter/.test(s)) return "campanas";
  return "otro";
}

/** Si el encargo no dejó rastro de herramientas, se estima por las palabras del título. */
const PALABRAS_DEL_TITULO: readonly (readonly [RegExp, TipoTrabajo])[] = [
  [/pie de p[aá]gina|footer|encabezado|header|men[uú]|dise[nñ]o|plantilla|colores?|logo|tipograf/i, "diseno"],
  [/plugin/i, "plugins"],
  [/copia|backup|restaur|recuper/i, "copias"],
  [/usuario|comentario/i, "usuarios"],
  [/ajuste|configura/i, "ajustes"],
  [/campa[nñ]a|correo|newsletter|anuncio|redes sociales/i, "campanas"],
  // «Pie de página» es diseño, no una página: de ahí el lookbehind.
  [/(?<!pie de )p[aá]gina|entrada|blog|texto|precio|imagen|foto|producto|contenido|enlace|link|bot[oó]n/i, "contenido"],
  [/revis|diagn|verific|lent|ca[ií]d|error|funciona/i, "revision"],
];

export type EstimacionEncargo = {
  readonly minutos: number;
  readonly tipos: readonly TipoTrabajo[];
  /** true si no hubo herramientas y se estimó leyendo el título. */
  readonly porTitulo: boolean;
};

export function estimarEncargo(input: {
  readonly herramientas: readonly string[];
  readonly titulo: string;
}): EstimacionEncargo {
  const tipos = new Set<TipoTrabajo>();
  for (const herramienta of input.herramientas) {
    const tipo = tipoDeHerramienta(herramienta);
    if (tipo) tipos.add(tipo);
  }

  let porTitulo = false;
  if (tipos.size === 0) {
    porTitulo = true;
    for (const [patron, tipo] of PALABRAS_DEL_TITULO) {
      if (patron.test(input.titulo)) tipos.add(tipo);
    }
    if (tipos.size === 0) tipos.add("otro");
  }

  const bruto = [...tipos].reduce((suma, tipo) => suma + TRABAJOS[tipo].minutos, 0);
  const minutos = Math.min(MAXIMO_POR_ENCARGO, Math.max(MINIMO_POR_ENCARGO, bruto));
  return { minutos, tipos: [...tipos], porTitulo };
}

/**
 * Reparte los minutos de un encargo entre sus tipos, en proporción a la tabla.
 * Así el desglose por tipo suma exactamente el total aunque se aplique el
 * mínimo o el máximo por encargo.
 */
export function repartirPorTipo(estimacion: EstimacionEncargo): ReadonlyMap<TipoTrabajo, number> {
  const bruto = estimacion.tipos.reduce((suma, tipo) => suma + TRABAJOS[tipo].minutos, 0);
  const reparto = new Map<TipoTrabajo, number>();
  for (const tipo of estimacion.tipos) {
    reparto.set(tipo, bruto > 0 ? (estimacion.minutos * TRABAJOS[tipo].minutos) / bruto : 0);
  }
  return reparto;
}

// ── Dinero ──────────────────────────────────────────────────────────────────

/** 1.000 créditos = 1 USD, igual que en toda la facturación de Strappy. */
export const CREDITOS_POR_USD = 1000;

export const MONEDAS = ["USD", "COP", "MXN", "EUR", "PEN", "CLP", "ARS"] as const;
export type Moneda = (typeof MONEDAS)[number];

/**
 * Tarifa por hora de partida si el negocio no puso la suya: el coste
 * aproximado de una hora de un asistente o técnico junior en cada moneda. Es un
 * punto de partida, no un dato: la pantalla invita a cambiarla.
 */
export const TARIFA_POR_DEFECTO: Readonly<Record<Moneda, number>> = {
  USD: 8,
  COP: 30000,
  MXN: 150,
  EUR: 12,
  PEN: 30,
  CLP: 7000,
  ARS: 9000,
};

export function esMoneda(valor: unknown): valor is Moneda {
  return typeof valor === "string" && (MONEDAS as readonly string[]).includes(valor);
}

export type AjustesImpacto = {
  readonly moneda: Moneda;
  readonly tarifaHora: number;
  /** Cuántas unidades de la moneda vale 1 USD. null si no se ha dicho (y la moneda no es USD). */
  readonly usdAMoneda: number | null;
  /** false mientras se usan los valores por defecto. */
  readonly personalizada: boolean;
};

/** Lee la tarifa guardada en `workspaces.settings.impacto`, con valores por defecto sensatos. */
export function leerAjustesImpacto(
  settings: Readonly<Record<string, unknown>> | null | undefined,
  monedaEmpresa: string | null | undefined,
): AjustesImpacto {
  const guardado = settings?.["impacto"];
  const impacto = guardado && typeof guardado === "object" ? (guardado as Record<string, unknown>) : {};

  const monedaGuardada = impacto["moneda"];
  const moneda: Moneda = esMoneda(monedaGuardada) ? monedaGuardada : esMoneda(monedaEmpresa) ? monedaEmpresa : "USD";

  const tarifa = Number(impacto["tarifa_hora"]);
  const tarifaValida = Number.isFinite(tarifa) && tarifa > 0 && esMoneda(monedaGuardada);

  const usd = Number(impacto["usd_a_moneda"]);
  const usdValido = Number.isFinite(usd) && usd > 0;

  return {
    moneda,
    tarifaHora: tarifaValida ? tarifa : TARIFA_POR_DEFECTO[moneda],
    usdAMoneda: moneda === "USD" ? 1 : usdValido ? usd : null,
    personalizada: tarifaValida,
  };
}

export function ahorroDeMinutos(minutos: number, tarifaHora: number): number {
  return (minutos / 60) * tarifaHora;
}

export function costeUsd(creditos: number): number {
  return creditos / CREDITOS_POR_USD;
}

/**
 * Cuántas veces se recupera lo gastado: ahorro ÷ coste, en la misma moneda.
 * Sin tipo de cambio no se inventa uno: devuelve null y la pantalla lo pide.
 */
export function retornoDe(input: {
  readonly ahorro: number;
  readonly costeUsd: number;
  readonly ajustes: AjustesImpacto;
}): number | null {
  if (input.costeUsd <= 0) return null;
  const cambio = input.ajustes.moneda === "USD" ? 1 : input.ajustes.usdAMoneda;
  if (!cambio) return null;
  return input.ahorro / (input.costeUsd * cambio);
}

/** Variación relativa contra el periodo anterior, o null si no había base. */
export function variacion(valor: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return (valor - anterior) / anterior;
}

// ── El resumen de un periodo ────────────────────────────────────────────────

export type EncargoParaImpacto = {
  readonly id: string;
  readonly agenteId: string | null;
  readonly titulo: string;
  /** Día en que terminó, `YYYY-MM-DD` en la zona del espacio. */
  readonly dia: string;
  /** ISO 8601 del momento en que terminó. */
  readonly terminado: string;
  readonly herramientas: readonly string[];
  readonly creditos: number;
};

export type TotalesImpacto = {
  readonly completados: number;
  readonly minutos: number;
  readonly ahorro: number;
  readonly creditos: number;
  readonly costeUsd: number;
  readonly retorno: number | null;
};

export type EncargoConImpacto = EncargoParaImpacto &
  EstimacionEncargo & {
    readonly ahorro: number;
  };

export type ResumenImpacto = {
  readonly actual: TotalesImpacto;
  readonly anterior: TotalesImpacto;
  readonly serie: readonly {
    readonly dia: string;
    readonly completados: number;
    readonly ahorro: number;
    readonly ahorroAcumulado: number;
  }[];
  readonly porAgente: readonly {
    readonly agenteId: string | null;
    readonly completados: number;
    readonly minutos: number;
    readonly ahorro: number;
    readonly creditos: number;
  }[];
  readonly porTipo: readonly {
    readonly tipo: TipoTrabajo;
    readonly etiqueta: string;
    readonly encargos: number;
    readonly minutos: number;
    readonly ahorro: number;
  }[];
  readonly recientes: readonly EncargoConImpacto[];
};

function dentro(dia: string, rango: RangoDias): boolean {
  return dia >= rango.desde && dia <= rango.hasta;
}

function totales(encargos: readonly EncargoConImpacto[], ajustes: AjustesImpacto): TotalesImpacto {
  const minutos = encargos.reduce((s, e) => s + e.minutos, 0);
  const ahorro = encargos.reduce((s, e) => s + e.ahorro, 0);
  const creditos = encargos.reduce((s, e) => s + e.creditos, 0);
  const coste = costeUsd(creditos);
  return {
    completados: encargos.length,
    minutos,
    ahorro,
    creditos,
    costeUsd: coste,
    retorno: retornoDe({ ahorro, costeUsd: coste, ajustes }),
  };
}

export function resumirImpacto(input: {
  readonly encargos: readonly EncargoParaImpacto[];
  readonly rango: RangoDias;
  readonly anterior: RangoDias;
  readonly ajustes: AjustesImpacto;
  /** Cuántos encargos enseñar en «Trabajo reciente». */
  readonly recientes?: number;
}): ResumenImpacto {
  const conImpacto: EncargoConImpacto[] = input.encargos.map((encargo) => {
    const estimacion = estimarEncargo(encargo);
    return { ...encargo, ...estimacion, ahorro: ahorroDeMinutos(estimacion.minutos, input.ajustes.tarifaHora) };
  });

  const actuales = conImpacto.filter((e) => dentro(e.dia, input.rango));
  const anteriores = conImpacto.filter((e) => dentro(e.dia, input.anterior));

  let acumulado = 0;
  const serie = diasDelRango(input.rango).map((dia) => {
    const delDia = actuales.filter((e) => e.dia === dia);
    const ahorro = delDia.reduce((s, e) => s + e.ahorro, 0);
    acumulado += ahorro;
    return { dia, completados: delDia.length, ahorro, ahorroAcumulado: acumulado };
  });

  const agentes = new Map<string | null, { completados: number; minutos: number; ahorro: number; creditos: number }>();
  const tipos = new Map<TipoTrabajo, { encargos: number; minutos: number }>();
  for (const encargo of actuales) {
    const fila = agentes.get(encargo.agenteId) ?? { completados: 0, minutos: 0, ahorro: 0, creditos: 0 };
    fila.completados += 1;
    fila.minutos += encargo.minutos;
    fila.ahorro += encargo.ahorro;
    fila.creditos += encargo.creditos;
    agentes.set(encargo.agenteId, fila);

    for (const [tipo, minutos] of repartirPorTipo(encargo)) {
      const t = tipos.get(tipo) ?? { encargos: 0, minutos: 0 };
      t.encargos += 1;
      t.minutos += minutos;
      tipos.set(tipo, t);
    }
  }

  return {
    actual: totales(actuales, input.ajustes),
    anterior: totales(anteriores, input.ajustes),
    serie,
    porAgente: [...agentes.entries()]
      .map(([agenteId, fila]) => ({ agenteId, ...fila }))
      .sort((a, b) => b.ahorro - a.ahorro),
    porTipo: [...tipos.entries()]
      .map(([tipo, fila]) => ({
        tipo,
        etiqueta: TRABAJOS[tipo].etiqueta,
        encargos: fila.encargos,
        minutos: fila.minutos,
        ahorro: ahorroDeMinutos(fila.minutos, input.ajustes.tarifaHora),
      }))
      .sort((a, b) => b.minutos - a.minutos),
    recientes: [...actuales]
      .sort((a, b) => b.terminado.localeCompare(a.terminado))
      .slice(0, input.recientes ?? 10),
  };
}

// ── Formatos ────────────────────────────────────────────────────────────────

/** «US$ 1.240» o «$ 250.000»: sin decimales cuando no aportan. */
export function formatearDinero(valor: number, moneda: Moneda): string {
  const decimales = moneda === "USD" || moneda === "EUR" ? (Math.abs(valor) < 100 ? 2 : 0) : 0;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

/** «45 min», «3 h», «12 h 30 min». */
export function formatearHoras(minutos: number): string {
  const total = Math.round(minutos);
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** «4,2×» para el retorno. */
export function formatearRetorno(retorno: number): string {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: retorno < 10 ? 1 : 0 }).format(retorno)}×`;
}
