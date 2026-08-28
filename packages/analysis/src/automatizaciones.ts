/**
 * Automatizaciones sin código.
 *
 * Una regla es un dato (`automations.trigger` / `.actions` en jsonb), nunca
 * código: el cliente crea reglas sin que nadie despliegue nada. Aquí solo se
 * evalúa el disparo y se delega la acción en un puerto.
 */
import type { ResultadoAnalisis, ValorExtraido } from "./tipos.js";
import type { ContextoDeAccion, EjecutorDeAccionesPort, ResultadoAccion } from "./ports.js";

export type Operador =
  | "igual"
  | "distinto"
  | "mayor"
  | "menor"
  | "contiene"
  | "existe"
  | "no_existe"
  | "en";

export type DisparoPorVariable = {
  readonly variable: string;
  readonly operador: Operador;
  readonly valor?: unknown;
};

export type DisparoPorObjetivo = { readonly objetivoLogrado: true };

export type Disparo = DisparoPorVariable | DisparoPorObjetivo;

export type TipoDeAccion = "email" | "whatsapp" | "webhook" | "tarea" | "crm";

export type Accion = {
  readonly tipo: TipoDeAccion;
  readonly config: Readonly<Record<string, unknown>>;
};

export type Automatizacion = {
  readonly id: string;
  readonly workspaceId: string;
  readonly nombre: string;
  readonly activa: boolean;
  readonly disparo: Disparo;
  /** Condiciones adicionales: todas deben cumplirse (Y lógico). */
  readonly condiciones?: readonly Disparo[];
  readonly acciones: readonly Accion[];
};

export type EjecucionDeAutomatizacion = {
  readonly automationId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly estado: "succeeded" | "failed" | "skipped";
  readonly motivoOmision?: string;
  readonly resultados: readonly ResultadoAccion[];
  readonly error?: string;
  readonly latenciaMs: number;
  /** Reintentar el análisis no puede duplicar el aviso al dueño. */
  readonly claveIdempotencia: string;
};

export type ContextoDeDisparo = {
  readonly variables: Readonly<Record<string, ValorExtraido>>;
  readonly objetivoLogrado: boolean;
  readonly objetivoScore: number;
  readonly sentimiento: string;
};

export function contextoDesdeAnalisis(r: ResultadoAnalisis): ContextoDeDisparo {
  return {
    variables: r.variables,
    objetivoLogrado: r.objetivoLogrado,
    objetivoScore: r.objetivoScore,
    sentimiento: r.sentimiento,
  };
}

function esDisparoPorObjetivo(d: Disparo): d is DisparoPorObjetivo {
  return "objetivoLogrado" in d;
}

/** Valor de la izquierda: una variable extraída o uno de los campos base. */
function leer(ctx: ContextoDeDisparo, nombre: string): ValorExtraido | undefined {
  switch (nombre) {
    case "objetivo_logrado":
      return ctx.objetivoLogrado;
    case "objetivo_score":
      return ctx.objetivoScore;
    case "sentimiento":
      return ctx.sentimiento;
    default:
      return ctx.variables[nombre];
  }
}

function presente(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

export function evaluarDisparo(d: Disparo, ctx: ContextoDeDisparo): boolean {
  if (esDisparoPorObjetivo(d)) return ctx.objetivoLogrado === true;

  const izquierda = leer(ctx, d.variable);
  switch (d.operador) {
    case "existe":
      return presente(izquierda);
    case "no_existe":
      return !presente(izquierda);
    case "igual":
      // Sin valor no hay comparación posible: se trata como no disparada, no
      // como verdadera. Una regla mal escrita no debe avisar al dueño.
      return presente(izquierda) && iguales(izquierda, d.valor);
    case "distinto":
      return presente(izquierda) && !iguales(izquierda, d.valor);
    case "mayor":
      return numero(izquierda) !== null && numero(d.valor) !== null && numero(izquierda)! > numero(d.valor)!;
    case "menor":
      return numero(izquierda) !== null && numero(d.valor) !== null && numero(izquierda)! < numero(d.valor)!;
    case "contiene":
      return (
        typeof izquierda === "string" &&
        typeof d.valor === "string" &&
        normalizar(izquierda).includes(normalizar(d.valor))
      );
    case "en":
      return Array.isArray(d.valor) && d.valor.some((v) => iguales(izquierda, v));
    default:
      return false;
  }
}

function iguales(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return normalizar(a) === normalizar(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  const na = numero(a);
  const nb = numero(b);
  if (na !== null && nb !== null) return na === nb;
  return a === b;
}

function numero(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Sin tildes, sin mayúsculas y sin bordes: «Caliente» y «caliente» son lo mismo. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function debeDispararse(a: Automatizacion, ctx: ContextoDeDisparo): boolean {
  if (!a.activa) return false;
  if (!evaluarDisparo(a.disparo, ctx)) return false;
  return (a.condiciones ?? []).every((c) => evaluarDisparo(c, ctx));
}

/**
 * Lee un `trigger` de jsonb tal cual está en la base y lo convierte en un
 * disparo utilizable. Devuelve `null` si no lo es: una regla ilegible se salta
 * con motivo, no se interpreta a la ligera.
 */
export function normalizarDisparo(raw: unknown): Disparo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["objetivoLogrado"] === true || o["objetivo_logrado"] === true) return { objetivoLogrado: true };
  const variable = typeof o["variable"] === "string" ? o["variable"] : null;
  const operador = typeof o["operador"] === "string" ? o["operador"] : "igual";
  if (!variable) return null;
  const validos: readonly string[] = [
    "igual", "distinto", "mayor", "menor", "contiene", "existe", "no_existe", "en",
  ];
  if (!validos.includes(operador)) return null;
  return { variable, operador: operador as Operador, ...(("valor" in o) ? { valor: o["valor"] } : {}) };
}

export type DepsAutomatizaciones = {
  readonly automatizaciones: import("./ports.js").AutomatizacionesPort;
  readonly acciones: EjecutorDeAccionesPort;
  readonly now?: () => Date;
};

/**
 * Corre las automatizaciones del espacio contra un análisis recién hecho.
 * Nunca lanza: una acción rota no puede tumbar el análisis, que es el dato.
 */
export async function ejecutarAutomatizaciones(
  deps: DepsAutomatizaciones,
  input: {
    readonly contexto: ContextoDeAccion;
    readonly agentId: string;
  },
): Promise<readonly EjecucionDeAutomatizacion[]> {
  const now = deps.now ?? (() => new Date());
  const ctx = contextoDesdeAnalisis(input.contexto.resultado);
  const reglas = await deps.automatizaciones.listarActivas({
    workspaceId: input.contexto.workspaceId,
    agentId: input.agentId,
  });

  const ejecuciones: EjecucionDeAutomatizacion[] = [];
  for (const regla of reglas) {
    const inicio = now().getTime();
    const clave = `${regla.id}:${input.contexto.conversationId}:${input.contexto.analisisId ?? "sin-analisis"}`;
    if (!debeDispararse(regla, ctx)) continue;

    const resultados: ResultadoAccion[] = [];
    let error: string | undefined;
    for (const accion of regla.acciones) {
      try {
        resultados.push(await deps.acciones.ejecutar(accion, input.contexto));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        resultados.push({ ok: false, detalle: error });
        break;
      }
    }
    const fallo = Boolean(error) || resultados.some((r) => !r.ok);
    const ejecucion: EjecucionDeAutomatizacion = {
      automationId: regla.id,
      workspaceId: regla.workspaceId,
      conversationId: input.contexto.conversationId,
      estado: fallo ? "failed" : "succeeded",
      resultados,
      ...(error ? { error } : {}),
      latenciaMs: Math.max(0, now().getTime() - inicio),
      claveIdempotencia: clave,
    };
    ejecuciones.push(ejecucion);
    await deps.automatizaciones.registrarEjecucion(ejecucion).catch(() => {});
  }
  return ejecuciones;
}
