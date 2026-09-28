/**
 * Todo lo que Alegra sabe del negocio, por su servidor MCP.
 *
 * Las herramientas propias del agente (caja, facturas por cobrar, clientes)
 * vienen ya sumadas y redactadas, y siguen siendo lo primero. Pero el cliente
 * pregunta por la nómina, por los gastos de un proveedor, por el inventario o
 * por el estado de resultados, y eso vive en otras partes de Alegra. En vez de
 * escribir una herramienta por cada pregunta posible —Alegra expone cientos de
 * consultas—, aquí hay dos:
 *
 *  - `admin_alegra_buscar` encuentra la consulta de Alegra que sirve.
 *  - `admin_alegra_consultar` la ejecuta, siempre de solo lectura, y trae solo
 *    los campos que se piden: una lista de nóminas son 50 KB por tres personas,
 *    y meter eso entero al modelo es pagar por leer lo que no se usa.
 *
 * Cientos de herramientas sueltas en el prompt costarían más tokens en cada
 * paso de los que ahorran. Así el catálogo viaja solo cuando hace falta.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno } from "./comun.js";
import type { AlegraMcpPort, HerramientaMcp } from "../adaptadores/alegra-mcp.js";
import type { LibrosContext } from "../ports.js";

function requireAlegra(libros: LibrosContext, slug: string): AlegraMcpPort {
  if (!libros.alegra) {
    throw new Error(
      `La herramienta "${slug}" necesita que el cliente conecte su cuenta de Alegra con «Conectar con mi cuenta de Alegra» en Ajustes → Contabilidad. ` +
        "Sin eso solo se ven facturas, cobros y clientes. Dilo así en el RESUMEN.",
    );
  }
  return libros.alegra;
}

// ---------------------------------------------------------------------------
// Qué se puede usar
// ---------------------------------------------------------------------------

/** Verbos que cambian datos. Alegra dice que su MCP solo lee; esto es la segunda red. */
// El verbo tiene que ir completo: «pay» a secas se comería «payroll», que es justo la nómina.
const ESCRIBE = /(^|[_-])(create|update|delete|remove|cancel|void|emit|send|stamp|apply|approve|import|upload|share|trash|untrash|revoke)(?=[A-Z_-]|$)/;
/** Excepciones: se llaman «create» pero solo generan un archivo para descargar. */
const SOLO_EXPORTA = /exportable|report|summary|download/i;

export function esDeLectura(h: HerramientaMcp): boolean {
  if (h.soloLectura === true) return true;
  if (h.soloLectura === false) return false;
  return !ESCRIBE.test(h.nombre) || SOLO_EXPORTA.test(h.nombre);
}

// ---------------------------------------------------------------------------
// Buscar
// ---------------------------------------------------------------------------

/** Lo que dice el cliente → cómo lo llama Alegra en sus herramientas. */
const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  nomina: ["payroll", "payrolls", "employee", "salary"],
  sueldo: ["payroll", "salary"],
  sueldos: ["payroll", "salary"],
  salario: ["payroll", "salary"],
  salarios: ["payroll", "salary"],
  liquidacion: ["payroll", "settlement", "termination"],
  empleado: ["employee", "payroll"],
  empleados: ["employee", "payroll"],
  prestaciones: ["payroll", "settlement"],
  pila: ["pila", "payroll"],
  gasto: ["expense", "bill", "outgoing"],
  gastos: ["expense", "bill", "outgoing"],
  egreso: ["outgoing", "payment", "expense"],
  egresos: ["outgoing", "payment", "expense"],
  proveedor: ["bill", "expense", "contact"],
  proveedores: ["bill", "expense", "contact"],
  compra: ["bill", "purchase", "expense"],
  compras: ["bill", "purchase", "expense"],
  factura: ["invoice", "bill"],
  facturas: ["invoice", "bill"],
  cliente: ["contact", "client"],
  clientes: ["contact", "client"],
  pago: ["payment"],
  pagos: ["payment"],
  cobro: ["payment", "receivable", "income"],
  cobros: ["payment", "receivable", "income"],
  banco: ["bank"],
  bancos: ["bank"],
  inventario: ["item", "stock", "inventory", "warehouse"],
  producto: ["item"],
  productos: ["item"],
  bodega: ["warehouse"],
  reporte: ["report"],
  informe: ["report"],
  ventas: ["sales", "invoice", "report"],
  utilidad: ["profit", "loss"],
  ganancia: ["profit"],
  perdida: ["loss"],
  resultados: ["profit", "loss"],
  balance: ["balance"],
  impuesto: ["tax", "retention"],
  impuestos: ["tax", "retention"],
  retencion: ["retention"],
  retenciones: ["retention"],
  cotizacion: ["estimate"],
  cotizaciones: ["estimate"],
  remision: ["remission"],
  nota: ["note", "credit", "debit"],
  credito: ["credit"],
  vendedor: ["seller"],
  costo: ["cost"],
  centro: ["cost", "center"],
  contable: ["accounting", "journal", "ledger"],
  asiento: ["journal", "ledger"],
  cuenta: ["account", "ledger", "bank"],
  deben: ["receivable"],
  debemos: ["payable"],
  pagar: ["payable", "payment"],
  cobrar: ["receivable"],
  periodo: ["period"],
};

const normal = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function terminos(que: string): string[] {
  const palabras = normal(que).split(/[^a-z0-9]+/).filter((p) => p.length > 2);
  return [...new Set(palabras.flatMap((p) => [p, ...(SINONIMOS[p] ?? [])]))];
}

/** Los parámetros de una herramienta, en una línea cada uno. */
function parametros(esquema: Readonly<Record<string, unknown>>): Record<string, string> {
  const props = (esquema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const requeridos = new Set((esquema.required as string[] | undefined) ?? []);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props).slice(0, 25)) {
    const tipo = Array.isArray(v.type) ? v.type.join("|") : String(v.type ?? (v.enum ? "enum" : "?"));
    const extra = [
      v.enum ? `uno de ${(v.enum as unknown[]).slice(0, 8).join(", ")}` : "",
      v.pattern ? `formato ${String(v.pattern)}` : "",
      typeof v.description === "string" ? v.description.slice(0, 90) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    out[k] = `${tipo}${requeridos.has(k) ? " (obligatorio)" : ""}${extra ? ` — ${extra}` : ""}`;
  }
  return out;
}

export const adminAlegraBuscar = defineTool({
  slug: "admin_alegra_buscar",
  label: "Buscar en Alegra",
  description:
    "Busca, entre todas las consultas que ofrece Alegra (contabilidad, nómina, empleados, gastos, proveedores, inventario, bancos, impuestos, reportes contables…), las que sirven para lo que te preguntaron. Devuelve su nombre y sus parámetros.",
  whenToUse:
    "cuando la pregunta no la cubren tus herramientas de caja y facturas: nómina, sueldos, empleados, gastos por proveedor, compras, inventario, estado de resultados, balance, impuestos…",
  inputSchema: z.object({
    que: z.string().min(2).max(200).describe("Qué necesitas, en palabras: «nómina de septiembre», «gastos por proveedor», «estado de resultados»."),
    max: z.number().int().min(1).max(15).default(8),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_alegra_buscar");
    const alegra = requireAlegra(libros, "admin_alegra_buscar");
    const todas = (await alegra.herramientas()).filter(esDeLectura);
    const t = terminos(input.que);
    const puntuadas = todas
      .map((h) => {
        const nombre = normal(h.nombre);
        const desc = normal(h.descripcion);
        const puntos = t.reduce((s, x) => s + (nombre.includes(x) ? 3 : 0) + (desc.includes(x) ? 1 : 0), 0);
        // Las de listar suelen ser la puerta de entrada: van primero a igualdad.
        return { h, puntos: puntos + (/(list|get)/.test(nombre) ? 0.5 : 0) };
      })
      .filter((x) => x.puntos >= 1)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, input.max);
    return {
      disponibles_en_alegra: todas.length,
      encontradas: puntuadas.map(({ h }) => ({
        herramienta: h.nombre,
        que_hace: h.descripcion.replace(/\s+/g, " ").slice(0, 320),
        parametros: parametros(h.esquema),
      })),
      ...(puntuadas.length === 0 ? { nota: "Nada encaja. Prueba con otras palabras, o en inglés como las llama Alegra (payroll, bill, expense, report)." } : {}),
    };
  },
});

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

const TOPE_TEXTO = 18_000;

/** Se queda solo con las rutas pedidas. Las listas se recorren solas: «payrolls.totals.amountToPay». */
export function elegirCampos(dato: unknown, rutas: readonly string[]): unknown {
  const partes = rutas.map((r) => r.split(".").filter(Boolean));
  const elegir = (v: unknown, caminos: string[][]): unknown => {
    if (caminos.some((c) => c.length === 0)) return v;
    if (Array.isArray(v)) return v.map((x) => elegir(x, caminos));
    if (v === null || typeof v !== "object") return undefined;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const porClave = new Map<string, string[][]>();
    for (const c of caminos) {
      const [cabeza, ...resto] = c;
      porClave.set(cabeza!, [...(porClave.get(cabeza!) ?? []), resto]);
    }
    for (const [k, sub] of porClave) {
      if (k in o) {
        const r = elegir(o[k], sub);
        if (r !== undefined) out[k] = r;
      }
    }
    return out;
  };
  return elegir(dato, partes);
}

/** El esqueleto de una respuesta: qué claves hay, de qué tipo, y un ejemplo corto. */
export function estructura(dato: unknown, profundidad = 0): unknown {
  if (profundidad > 5) return "…";
  if (Array.isArray(dato)) return dato.length === 0 ? [] : [`${dato.length} elementos, cada uno así:`, estructura(dato[0], profundidad + 1)];
  if (dato === null || typeof dato !== "object") {
    const s = typeof dato === "string" ? `"${dato.slice(0, 30)}"` : String(dato);
    return `${typeof dato} ${s}`;
  }
  return Object.fromEntries(Object.entries(dato as Record<string, unknown>).slice(0, 40).map(([k, v]) => [k, estructura(v, profundidad + 1)]));
}

/** Corta las listas largas: con 50 filas se contesta casi cualquier cosa. */
function acotarListas(v: unknown, max: number): { valor: unknown; recortadas: boolean } {
  let recortadas = false;
  const r = (x: unknown): unknown => {
    if (Array.isArray(x)) {
      if (x.length > max) recortadas = true;
      return x.slice(0, max).map(r);
    }
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, r(y)]));
    return x;
  };
  return { valor: r(v), recortadas };
}

export const adminAlegraConsultar = defineTool({
  slug: "admin_alegra_consultar",
  label: "Consultar Alegra",
  description:
    "Ejecuta una consulta de Alegra (de las que dio admin_alegra_buscar) con sus parámetros. Solo lee: nunca cambia nada. Con «campos» trae solo lo que necesitas (rutas con puntos; las listas se recorren solas, p. ej. «data.payrolls.employee.name»). Sin «campos», si la respuesta es grande, te devuelve su estructura para que elijas.",
  whenToUse: "después de admin_alegra_buscar, para traer los datos con los que contestar",
  inputSchema: z.object({
    herramienta: z.string().min(2).max(120),
    argumentos: z.record(z.string(), z.unknown()).default({}),
    campos: z
      .array(z.string().min(1).max(160))
      .max(40)
      .optional()
      .describe("Rutas a conservar, p. ej. [\"data.totals\", \"data.payrolls.employee.name\", \"data.payrolls.totals.amountToPay\"]."),
    max_filas: z.number().int().min(1).max(200).default(50),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.contabilidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { libros } = entorno(ctx, "admin_alegra_consultar");
    const alegra = requireAlegra(libros, "admin_alegra_consultar");
    const todas = await alegra.herramientas();
    const h = todas.find((x) => x.nombre === input.herramienta);
    if (!h) {
      throw new Error(`Alegra no tiene una consulta «${input.herramienta}». Búscala con admin_alegra_buscar y usa el nombre exacto.`);
    }
    if (!esDeLectura(h)) {
      throw new Error(`«${h.nombre}» cambia datos en Alegra. Por aquí solo se consulta: eso lo hace una persona o una herramienta con aprobación.`);
    }

    const r = await alegra.llamar(h.nombre, input.argumentos);
    if (r.esError) throw new Error(`Alegra respondió con un error: ${r.texto.slice(0, 400)}`);
    if (r.datos === null) return { respuesta: r.texto.slice(0, TOPE_TEXTO) };

    const elegido = input.campos?.length ? elegirCampos(r.datos, input.campos) : r.datos;
    const { valor, recortadas } = acotarListas(elegido, input.max_filas);
    const texto = JSON.stringify(valor);
    if (texto.length > TOPE_TEXTO) {
      return {
        demasiado_grande: true,
        tamano: texto.length,
        estructura: estructura(valor),
        nota: "La respuesta es demasiado grande para leerla entera. Vuelve a llamar con «campos» eligiendo solo lo que necesitas de esta estructura (y, si aplica, filtros de fecha o menos filas).",
      };
    }
    return { datos: valor, ...(recortadas ? { nota: `Algunas listas se cortaron a ${input.max_filas} filas.` } : {}) };
  },
});

export const HERRAMIENTAS_ALEGRA: readonly ToolDef<never, unknown>[] = [
  adminAlegraBuscar,
  adminAlegraConsultar,
] as unknown as readonly ToolDef<never, unknown>[];
