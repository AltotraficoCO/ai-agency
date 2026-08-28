/**
 * Dobles de los puertos y del modelo.
 *
 * El modelo va guionizado: se le dicta paso a paso qué herramientas llama y
 * con qué argumentos. No es una prueba de que el modelo decida bien —eso no se
 * prueba con un test— sino de que el bucle, las herramientas, los backups y la
 * puerta de aprobación hacen lo que dicen que hacen.
 */
import { MockLanguageModelV3 } from "ai/test";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider";
import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
  BackupPort,
  BackupRecord,
  BrowserPort,
  CapturaPantalla,
} from "../index.js";

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------

export class BackupsEnMemoria implements BackupPort {
  readonly guardados: BackupRecord[] = [];
  #n = 0;

  async create(input: { alcance: string; snapshot: unknown }): Promise<string> {
    const id = `bk_${++this.#n}`;
    this.guardados.push({
      id,
      alcance: input.alcance,
      snapshot: input.snapshot,
      creadoEn: new Date(0).toISOString(),
    });
    return id;
  }

  async read(input: { backupId: string }): Promise<BackupRecord | null> {
    return this.guardados.find((b) => b.id === input.backupId) ?? null;
  }
}

export class AprobacionesEnMemoria implements ApprovalPort {
  readonly solicitudes: {
    id: string;
    huella: string;
    toolSlug: string;
    motivo: string;
    entrada: unknown;
  }[] = [];
  readonly decisiones = new Map<string, ApprovalDecision>();
  #n = 0;

  /** Simula que una persona pulsó el botón. */
  decidir(huella: string, decision: ApprovalDecision): void {
    this.decisiones.set(huella, decision);
  }

  async check(input: { huella: string }): Promise<ApprovalDecision | null> {
    return this.decisiones.get(input.huella) ?? null;
  }

  async request(input: {
    huella: string;
    toolSlug: string;
    motivo: string;
    entrada: unknown;
  }): Promise<ApprovalRequest> {
    const ya = this.solicitudes.find((s) => s.huella === input.huella);
    if (ya) return { id: ya.id, decision: this.decisiones.get(input.huella) ?? null };
    const id = `ap_${++this.#n}`;
    this.solicitudes.push({
      id,
      huella: input.huella,
      toolSlug: input.toolSlug,
      motivo: input.motivo,
      entrada: input.entrada,
    });
    return { id, decision: null };
  }
}

/** Navegador de mentira: devuelve el HTML del doble como si lo hubiera pintado. */
export class NavegadorFalso implements BrowserPort {
  url = "";
  cerrado = false;
  readonly visitadas: string[] = [];

  constructor(
    private readonly base: string,
    private readonly buscarHtml: (ruta: string) => { titulo: string; texto: string; status: number },
  ) {}

  #captura(extra: Partial<CapturaPantalla> = {}): CapturaPantalla {
    return {
      base64: Buffer.from("jpeg-de-mentira").toString("base64"),
      mimeType: "image/jpeg",
      url: this.url,
      titulo: "",
      ...extra,
    };
  }

  async ir(path: string, _completa: boolean) {
    this.visitadas.push(path);
    this.url = `${this.base}${path}`;
    const p = this.buscarHtml(path);
    return { ...this.#captura({ titulo: p.titulo }), status: p.status };
  }

  async click() {
    return this.#captura();
  }

  async escribir() {
    return this.#captura();
  }

  async leer() {
    const ruta = this.url.slice(this.base.length) || "/";
    return { url: this.url, texto: this.buscarHtml(ruta).texto };
  }

  async consola() {
    return { url: this.url, consola: [] as string[] };
  }

  async cerrar() {
    this.cerrado = true;
  }
}

// ---------------------------------------------------------------------------
// Modelo guionizado
// ---------------------------------------------------------------------------

export type PasoGuion =
  | { readonly llama: string; readonly con?: unknown }
  | { readonly dice: string };

const USO_POR_PASO = {
  inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: 0 },
  outputTokens: { total: 80, text: 80, reasoning: 0 },
} as const;

/**
 * Un modelo que ejecuta un guion. Cada llamada consume un paso; si el guion se
 * acaba, repite el último (así se puede provocar el tope de acciones sin
 * escribir veinticinco entradas a mano).
 */
export function modeloGuionizado(guion: readonly PasoGuion[], repetirUltimo = false) {
  let i = 0;
  const llamadas: string[] = [];
  const modelo = new MockLanguageModelV3({
    doGenerate: async (): Promise<LanguageModelV3GenerateResult> => {
      const paso = guion[Math.min(i, guion.length - 1)];
      if (!repetirUltimo || i < guion.length) i += 1;
      if (!paso) throw new Error("El guion se quedó sin pasos.");
      if ("dice" in paso) {
        llamadas.push("(texto)");
        return {
          content: [{ type: "text", text: paso.dice }],
          finishReason: { unified: "stop", raw: "end_turn" },
          usage: USO_POR_PASO,
          warnings: [],
        };
      }
      llamadas.push(paso.llama);
      const content: LanguageModelV3Content[] = [
        {
          type: "tool-call",
          toolCallId: `tc_${llamadas.length}`,
          toolName: paso.llama,
          input: JSON.stringify(paso.con ?? {}),
        },
      ];
      return {
        content,
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage: USO_POR_PASO,
        warnings: [],
      };
    },
  });
  return { modelo, llamadas };
}

/** Un modelo que nunca responde: sirve para probar el timeout duro. */
export function modeloQueNoResponde() {
  return new MockLanguageModelV3({
    doGenerate: (opciones: LanguageModelV3CallOptions) =>
      new Promise<LanguageModelV3GenerateResult>((_resolver, rechazar) => {
        const señal = opciones.abortSignal;
        if (!señal) return;
        if (señal.aborted) return rechazar(abortError());
        señal.addEventListener("abort", () => rechazar(abortError()), { once: true });
      }),
  });
}

function abortError(): Error {
  const e = new Error("La operación se abortó.");
  e.name = "AbortError";
  return e;
}
