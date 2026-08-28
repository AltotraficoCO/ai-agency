import { describe, expect, it } from "vitest";
import { crearClienteWhatsApp } from "../src/client.js";
import { WhatsAppApiError } from "../src/errors.js";
import { GRAPH_API_VERSION } from "../src/types.js";
import { crearLimitadorRitmo } from "../src/rate-limit.js";
import { fixture } from "./fixtures.js";

function json(status: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json", ...cabeceras },
  });
}

function clienteCon(respuestas: Response[] | ((url: string, init?: RequestInit) => Promise<Response>)) {
  const urls: string[] = [];
  const cuerpos: unknown[] = [];
  let i = 0;
  const fetchFalso = async (url: string, init?: RequestInit) => {
    urls.push(url);
    cuerpos.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    if (typeof respuestas === "function") return respuestas(url, init);
    const r = respuestas[Math.min(i, respuestas.length - 1)]!;
    i++;
    return r;
  };
  const api = crearClienteWhatsApp({
    accessToken: "token_del_cliente",
    fetch: fetchFalso,
    dormir: async () => {},
    aleatorio: () => 0.5,
  });
  return { api, urls, cuerpos, intentos: () => urls.length };
}

describe("construcción de la URL", () => {
  it("usa la versión de la API de una sola constante", async () => {
    const { api, urls } = clienteCon([json(200, fixture("envio-ok"))]);
    await api.enviarTexto({ phoneNumberId: "106540352242922", to: "573009998877", text: "Hola" });
    expect(urls[0]).toBe(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/106540352242922/messages`,
    );
  });

  it("lleva el token del contexto en la cabecera, nunca en la URL", async () => {
    let cabeceras: Record<string, string> = {};
    const api = crearClienteWhatsApp({
      accessToken: "token_secreto",
      dormir: async () => {},
      fetch: async (_url, init) => {
        cabeceras = init?.headers as Record<string, string>;
        return json(200, fixture("envio-ok"));
      },
    });
    await api.enviarTexto({ phoneNumberId: "1", to: "2", text: "Hola" });
    expect(cabeceras.Authorization).toBe("Bearer token_secreto");
  });
});

describe("reintentos con retroceso exponencial", () => {
  it("reintenta un 130429 y acaba respondiendo bien", async () => {
    const { api, intentos } = clienteCon([
      json(400, fixture("error-130429")),
      json(400, fixture("error-130429")),
      json(200, fixture("envio-ok")),
    ]);
    const r = await api.enviarTexto({ phoneNumberId: "1", to: "2", text: "Hola" });
    expect(r.messages?.[0]?.id).toContain("wamid.");
    expect(intentos()).toBe(3);
  });

  it("NO reintenta un 131047: fuera de ventana no cambia por insistir", async () => {
    const { api, intentos } = clienteCon([json(400, fixture("error-131047"))]);
    await expect(api.enviarTexto({ phoneNumberId: "1", to: "2", text: "Hola" })).rejects.toMatchObject({
      decision: { accion: "requiere_plantilla" },
    });
    expect(intentos()).toBe(1);
  });

  it("NO reintenta un 132001 de plantilla", async () => {
    const { api, intentos } = clienteCon([json(400, fixture("error-132001"))]);
    await expect(
      api.enviarPlantilla({ phoneNumberId: "1", to: "2", nombre: "recordatorio_cita", idioma: "es" }),
    ).rejects.toBeInstanceOf(WhatsAppApiError);
    expect(intentos()).toBe(1);
  });

  it("NO reintenta un 190 y expone la decisión de revocar el token", async () => {
    const { api, intentos } = clienteCon([json(401, fixture("error-190"))]);
    await expect(api.leerNumero("1")).rejects.toMatchObject({
      decision: { marcarCuentaRevocada: true, pausarCola: true },
    });
    expect(intentos()).toBe(1);
  });

  it("agota los intentos y lanza el último error", async () => {
    const { api, intentos } = clienteCon([json(429, { error: { code: 130429 } })]);
    await expect(api.enviarTexto({ phoneNumberId: "1", to: "2", text: "Hola" })).rejects.toBeInstanceOf(
      WhatsAppApiError,
    );
    expect(intentos()).toBe(4);
  });

  it("el retroceso crece exponencialmente y respeta Retry-After", async () => {
    const esperas: number[] = [];
    const api = crearClienteWhatsApp({
      accessToken: "t",
      aleatorio: () => 1,
      baseEsperaMs: 100,
      dormir: async (ms) => void esperas.push(ms),
      fetch: async () => json(429, fixture("error-130429"), { "retry-after": "2" }),
    });
    await expect(api.enviarTexto({ phoneNumberId: "1", to: "2", text: "Hola" })).rejects.toBeTruthy();
    // Retry-After (2 s) manda sobre el retroceso base mientras sea mayor.
    expect(esperas).toEqual([2000, 2000, 2000]);
  });

  it("reintenta los fallos de red, que no traen cuerpo de Meta", async () => {
    let n = 0;
    const api = crearClienteWhatsApp({
      accessToken: "t",
      dormir: async () => {},
      fetch: async () => {
        n++;
        if (n < 3) throw new Error("ECONNRESET");
        return json(200, fixture("envio-ok"));
      },
    });
    await expect(api.enviarTexto({ phoneNumberId: "1", to: "2", text: "Hola" })).resolves.toBeTruthy();
    expect(n).toBe(3);
  });

  it("el marcado de leído no se reintenta: un recibo tardío no vale nada", async () => {
    const { api, intentos } = clienteCon([json(400, { error: { code: 130429 } })]);
    await expect(api.marcarLeido({ phoneNumberId: "1", messageId: "wamid.A" })).rejects.toBeTruthy();
    expect(intentos()).toBe(1);
  });

  it("el intercambio de código no se reintenta: el code es de un solo uso", async () => {
    const { api, intentos } = clienteCon([json(400, { error: { code: 1 } })]);
    await expect(
      api.intercambiarCodigo({ appId: "a", appSecret: "s", code: "c" }),
    ).rejects.toBeTruthy();
    expect(intentos()).toBe(1);
  });
});

describe("forma de las peticiones", () => {
  it("el audio y el sticker no llevan caption (Meta lo rechaza)", async () => {
    const { api, cuerpos } = clienteCon([json(200, fixture("envio-ok"))]);
    await api.enviarMedia({
      phoneNumberId: "1",
      to: "2",
      tipo: "audio",
      mediaId: "m1",
      caption: "no debería viajar",
    });
    expect(JSON.stringify(cuerpos[0])).not.toContain("no debería viajar");
  });

  it("la analítica de conversaciones se pide como campo compuesto", async () => {
    const { api, urls } = clienteCon([json(200, fixture("analitica-conversaciones"))]);
    await api.analiticaConversaciones({
      wabaId: "102290129340398",
      desde: 1000,
      hasta: 2000,
      granularidad: "DAILY",
      dimensiones: ["CONVERSATION_CATEGORY"],
    });
    const url = decodeURIComponent(urls[0] ?? "");
    expect(url).toContain("conversation_analytics.start(1000).end(2000).granularity(DAILY)");
    expect(url).toContain('dimensions(["CONVERSATION_CATEGORY"])');
  });

  it("debug_token se autoriza con el token de la app, no con el del cliente", async () => {
    const { api, urls } = clienteCon([json(200, fixture("debug-token"))]);
    await api.depurarToken({ inputToken: "token_cliente", appId: "111", appSecret: "sss" });
    const url = decodeURIComponent(urls[0] ?? "");
    expect(url).toContain("input_token=token_cliente");
    expect(url).toContain("access_token=111|sss");
  });
});

describe("límite de ritmo por phone_number_id", () => {
  it("frena cuando se agotan las fichas del número", async () => {
    let reloj = 0;
    const dormidas: number[] = [];
    const limitador = crearLimitadorRitmo({
      now: () => reloj,
      dormir: async (ms) => {
        dormidas.push(ms);
        reloj += ms;
      },
    });
    // TIER_50 permite 5 mensajes por segundo: el sexto tiene que esperar.
    for (let i = 0; i < 6; i++) await limitador.adquirir("106540352242922", "TIER_50");
    expect(dormidas).toHaveLength(1);
    expect(dormidas[0]).toBeGreaterThan(0);
  });

  it("números distintos no se estorban entre sí", async () => {
    const dormidas: number[] = [];
    const limitador = crearLimitadorRitmo({ now: () => 0, dormir: async (ms) => void dormidas.push(ms) });
    for (let i = 0; i < 5; i++) await limitador.adquirir("numero_a", "TIER_50");
    for (let i = 0; i < 5; i++) await limitador.adquirir("numero_b", "TIER_50");
    expect(dormidas).toHaveLength(0);
  });

  it("un nivel más alto permite más ritmo", async () => {
    const dormidas: number[] = [];
    const limitador = crearLimitadorRitmo({ now: () => 0, dormir: async (ms) => void dormidas.push(ms) });
    for (let i = 0; i < 20; i++) await limitador.adquirir("numero_c", "TIER_1K");
    expect(dormidas).toHaveLength(0);
  });
});

describe("descarga de media", () => {
  it("la URL firmada de Meta exige la misma cabecera de autorización", async () => {
    const cabeceras: Record<string, string>[] = [];
    const api = crearClienteWhatsApp({
      accessToken: "token_secreto",
      dormir: async () => {},
      fetch: async (_url, init) => {
        cabeceras.push(init?.headers as Record<string, string>);
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    });
    const datos = await api.descargarMedia("https://lookaside.fbsbx.com/whatsapp_business/x");
    expect(datos.byteLength).toBe(3);
    expect(cabeceras[0]?.Authorization).toBe("Bearer token_secreto");
  });

  it("un fallo de descarga sale como error decidido", async () => {
    const api = crearClienteWhatsApp({
      accessToken: "t",
      dormir: async () => {},
      fetch: async () => json(401, fixture("error-190")),
    });
    await expect(api.descargarMedia("https://x")).rejects.toMatchObject({
      decision: { marcarCuentaRevocada: true },
    });
  });
});
