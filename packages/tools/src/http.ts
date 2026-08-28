/**
 * Herramientas HTTP definidas por el cliente.
 *
 * El hueco previsto en el diseño: el cliente declara en base de datos la
 * forma de su endpoint y sale una herramienta más, indistinguible para el
 * modelo de las de sistema. Misma `ToolDef`, mismos dos adaptadores.
 *
 * Deny by default: el host tiene que estar en la lista blanca del puerto HTTP,
 * y las credenciales se resuelven por referencia en el momento de llamar.
 * El modelo nunca ve una credencial ni puede elegir a qué host se llama.
 */
import { z, type ZodType } from "zod";
import { defineTool, type ToolDef } from "./registry.js";
import { requirePort } from "./ports.js";
import type { ToolContext } from "./context.js";

export type HttpParamSpec = {
  readonly name: string;
  readonly in: "path" | "query" | "body" | "header";
  readonly type: "string" | "number" | "boolean";
  readonly description: string;
  readonly required?: boolean;
  readonly enum?: readonly string[];
};

/** Lo que se guarda en base de datos. Es dato puro, sin código. */
export type HttpToolSpec = {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** URL con marcadores {nombre} para los parámetros de ruta. */
  readonly urlTemplate: string;
  readonly params: readonly HttpParamSpec[];
  /** Cabeceras fijas. Los valores `{{secreto:ref}}` se resuelven en ejecución. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth?:
    | { readonly kind: "none" }
    | { readonly kind: "bearer"; readonly secretRef: string }
    | { readonly kind: "header"; readonly header: string; readonly secretRef: string };
  readonly sensitive?: boolean;
  readonly creditCost?: number;
  readonly scopes?: readonly string[];
  readonly timeoutMs?: number;
  /** Marca si la llamada cambia algo fuera del sistema. Decide el modo seco. */
  readonly mutates?: boolean;
};

export class HttpToolError extends Error {}

export function buildHttpTool(spec: HttpToolSpec): ToolDef<Record<string, unknown>, unknown> {
  const inputSchema = schemaFromParams(spec.params);

  return defineTool<Record<string, unknown>, unknown>({
    slug: spec.slug,
    label: spec.label,
    description: spec.description,
    ...(spec.whenToUse ? { whenToUse: spec.whenToUse } : {}),
    inputSchema,
    sensitive: spec.sensitive ?? false,
    creditCost: spec.creditCost ?? 2,
    scopes: spec.scopes ?? [`http:${spec.slug}`],
    effect: spec.mutates ? "write_external" : "read",
    kind: "http",
    async execute(ctx, input) {
      const http = requirePort(ctx.ports, "http", spec.slug);
      const { url, headers, body } = await buildRequest(spec, ctx, input);

      const host = new URL(url).host;
      if (!http.allowedHosts.includes(host)) {
        // Deny by default: si el host no se declaró, no se llama. Sin esto una
        // plantilla de URL manipulable convierte la herramienta en un proxy.
        throw new HttpToolError(
          `La herramienta "${spec.slug}" intentó llamar a "${host}", que no está en la lista de hosts permitidos.`,
        );
      }

      const res = await http.fetch({
        url,
        method: spec.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        timeoutMs: spec.timeoutMs ?? 15_000,
        ...(ctx.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
      });

      if (res.status >= 400) {
        throw new HttpToolError(
          `El servicio respondió ${res.status}. ${res.body.slice(0, 400)}`,
        );
      }
      return { estado: res.status, datos: parseBody(res.body) };
    },
    simulate(_ctx, input) {
      return {
        estado: 200,
        datos: null,
        simulado: true,
        nota: `En una conversación real esto llamaría a ${spec.method} ${spec.urlTemplate} con ${JSON.stringify(input)}.`,
      };
    },
  });
}

function schemaFromParams(params: readonly HttpParamSpec[]): ZodType<Record<string, unknown>> {
  const shape: Record<string, ZodType<unknown>> = {};
  for (const p of params) {
    let base: ZodType<unknown>;
    if (p.enum && p.enum.length > 0) {
      base = z.enum([...p.enum] as [string, ...string[]]) as unknown as ZodType<unknown>;
    } else if (p.type === "number") {
      base = z.number() as unknown as ZodType<unknown>;
    } else if (p.type === "boolean") {
      base = z.boolean() as unknown as ZodType<unknown>;
    } else {
      base = z.string() as unknown as ZodType<unknown>;
    }
    base = base.describe(p.description);
    shape[p.name] = (p.required === false ? base.optional() : base) as ZodType<unknown>;
  }
  return z.object(shape) as unknown as ZodType<Record<string, unknown>>;
}

async function buildRequest(
  spec: HttpToolSpec,
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<{ url: string; headers: Record<string, string>; body?: string }> {
  let url = spec.urlTemplate;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { accept: "application/json" };
  const body: Record<string, unknown> = {};

  for (const p of spec.params) {
    const value = input[p.name];
    if (value === undefined || value === null) continue;
    const texto = String(value);
    switch (p.in) {
      case "path":
        url = url.replace(`{${p.name}}`, encodeURIComponent(texto));
        break;
      case "query":
        query.set(p.name, texto);
        break;
      case "header":
        headers[p.name.toLowerCase()] = texto;
        break;
      case "body":
        body[p.name] = value;
        break;
    }
  }

  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    headers[k.toLowerCase()] = await resolveSecrets(v, ctx, spec.slug);
  }

  const auth = spec.auth;
  if (auth && auth.kind !== "none") {
    const secretos = requirePort(ctx.ports, "secrets", spec.slug);
    const valor = await secretos.resolve({ workspaceId: ctx.workspaceId, ref: auth.secretRef });
    if (auth.kind === "bearer") headers.authorization = `Bearer ${valor}`;
    else headers[auth.header.toLowerCase()] = valor;
  }

  const qs = query.toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  const conCuerpo = spec.method !== "GET" && spec.method !== "DELETE";
  if (conCuerpo && Object.keys(body).length > 0) {
    headers["content-type"] = "application/json";
    return { url, headers, body: JSON.stringify(body) };
  }
  return { url, headers };
}

/** Sustituye `{{secreto:ref}}` por su valor. Nunca se registra el resultado. */
async function resolveSecrets(value: string, ctx: ToolContext, toolSlug: string): Promise<string> {
  const marcadores = [...value.matchAll(/\{\{\s*secreto:([\w.-]+)\s*\}\}/g)];
  if (marcadores.length === 0) return value;
  const secretos = requirePort(ctx.ports, "secrets", toolSlug);
  let out = value;
  for (const m of marcadores) {
    const resuelto = await secretos.resolve({ workspaceId: ctx.workspaceId, ref: m[1]! });
    out = out.replace(m[0], resuelto);
  }
  return out;
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body.slice(0, 4000);
  }
}
