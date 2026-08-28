import { describe, expect, it, vi } from "vitest";
import { crearClienteWhatsApp } from "../src/client.js";
import {
  PASOS_REGISTRO,
  VERSION_SIGNUP,
  ejecutarRegistro,
  generarPinPorDefecto,
  normalizarPago,
  urlEmbeddedSignup,
  type EstadoRegistro,
} from "../src/signup.js";
import { fixture } from "./fixtures.js";

function json(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Servidor de Meta grabado: se enruta por la ruta pedida, como haría de verdad. */
function metaFalso(opciones: {
  fallarEn?: string;
  debugToken?: unknown;
} = {}) {
  const rutas: string[] = [];
  const fetchFalso = async (url: string): Promise<Response> => {
    const ruta = new URL(url).pathname;
    rutas.push(ruta);
    if (opciones.fallarEn && ruta.includes(opciones.fallarEn)) {
      return json(500, { error: { code: 1, message: "temporal" } });
    }
    if (ruta.includes("oauth/access_token")) {
      return json(200, { access_token: "TOKEN_DEL_CLIENTE", token_type: "bearer", expires_in: 0 });
    }
    if (ruta.includes("debug_token")) {
      return json(200, opciones.debugToken ?? fixture("debug-token"));
    }
    if (ruta.endsWith("/subscribed_apps")) return json(200, { success: true });
    if (ruta.endsWith("/register")) return json(200, { success: true });
    if (ruta.endsWith("/106540352242922")) return json(200, fixture("numero"));
    if (ruta.endsWith("/102290129340398")) return json(200, fixture("waba"));
    return json(404, { error: { code: 100, message: "ruta no grabada: " + ruta } });
  };
  return { fetchFalso, rutas };
}

function deps(fetchFalso: typeof fetch, guardados: EstadoRegistro[], generarPin = () => "123456") {
  return {
    app: { appId: "111", appSecret: "sss" },
    async guardarEstado(estado: EstadoRegistro) {
      guardados.push(structuredClone(estado));
    },
    generarPin,
    crearCliente: (accessToken: string) =>
      crearClienteWhatsApp({
        accessToken,
        maxIntentos: 1,
        dormir: async () => {},
        fetch: fetchFalso as never,
      }),
  };
}

const estadoInicial = (): EstadoRegistro => ({
  paso: "intercambiar_codigo",
  wabaId: "102290129340398",
  phoneNumberId: "106540352242922",
  signupVersion: VERSION_SIGNUP,
});

describe("Embedded Signup v4", () => {
  it("completa los cinco pasos y devuelve el resumen de la cuenta", async () => {
    const { fetchFalso, rutas } = metaFalso();
    const guardados: EstadoRegistro[] = [];
    const r = await ejecutarRegistro(
      { code: "CODIGO_DE_META", estado: estadoInicial() },
      deps(fetchFalso as never, guardados),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado.paso).toBe("completado");
    expect(r.resumen.qualityRating).toBe("GREEN");
    expect(r.resumen.messagingTier).toBe("TIER_1K");
    expect(r.resumen.businessVerificationStatus).toBe("verified");
    expect(r.resumen.accountReviewStatus).toBe("approved");
    // payment_status es lo que evita que el cliente crea que le cobramos nosotros.
    expect(r.resumen.paymentStatus).toBe("active");

    expect(rutas.some((x) => x.includes("oauth/access_token"))).toBe(true);
    expect(rutas.some((x) => x.includes("debug_token"))).toBe(true);
    expect(rutas.some((x) => x.endsWith("/subscribed_apps"))).toBe(true);
    expect(rutas.some((x) => x.endsWith("/register"))).toBe(true);
  });

  it("guarda el estado tras cada paso: sin eso no hay reanudación", async () => {
    const { fetchFalso } = metaFalso();
    const guardados: EstadoRegistro[] = [];
    await ejecutarRegistro({ code: "C", estado: estadoInicial() }, deps(fetchFalso as never, guardados));
    expect(guardados.map((g) => g.paso)).toEqual([
      "verificar_permisos",
      "suscribir_app",
      "registrar_numero",
      "leer_estado",
      "completado",
    ]);
  });

  it("si falla el paso 4, se retoma en el 4 y no desde el principio", async () => {
    const guardados: EstadoRegistro[] = [];
    const fallo = metaFalso({ fallarEn: "/register" });
    const primera = await ejecutarRegistro(
      { code: "CODIGO_DE_META", estado: estadoInicial() },
      deps(fallo.fetchFalso as never, guardados),
    );

    expect(primera.ok).toBe(false);
    if (primera.ok) return;
    expect(primera.reanudableEn).toBe("registrar_numero");
    expect(primera.estado.accessToken).toBe("TOKEN_DEL_CLIENTE");
    expect(primera.estado.appSuscrita).toBe(true);
    expect(primera.estado.pin).toBe("123456");
    expect(primera.mensaje).toContain("no hace falta empezar de nuevo");

    // Reanudación: sin `code`, porque el de Meta ya se consumió.
    const bueno = metaFalso();
    const segunda = await ejecutarRegistro(
      { estado: primera.estado },
      deps(bueno.fetchFalso as never, guardados),
    );

    expect(segunda.ok).toBe(true);
    // No se vuelve a intercambiar el código ni a pedir permisos.
    expect(bueno.rutas.some((x) => x.includes("oauth/access_token"))).toBe(false);
    expect(bueno.rutas.some((x) => x.includes("debug_token"))).toBe(false);
    expect(bueno.rutas.some((x) => x.endsWith("/register"))).toBe(true);
  });

  it("conserva el PIN al reintentar: cambiarlo haría que Meta rechazara el registro", async () => {
    const guardados: EstadoRegistro[] = [];
    const fallo = metaFalso({ fallarEn: "/register" });
    const generar = vi.fn(() => "654321");
    const primera = await ejecutarRegistro(
      { code: "C", estado: estadoInicial() },
      deps(fallo.fetchFalso as never, guardados, generar),
    );
    expect(primera.ok).toBe(false);
    if (primera.ok) return;

    const segunda = await ejecutarRegistro(
      { estado: primera.estado },
      deps(metaFalso().fetchFalso as never, guardados, generar),
    );
    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;
    expect(segunda.estado.pin).toBe("654321");
    expect(generar).toHaveBeenCalledTimes(1);
  });

  it("detiene el flujo si Meta no concedió los permisos de WhatsApp", async () => {
    const { fetchFalso } = metaFalso({ debugToken: fixture("debug-token-sin-permisos") });
    const guardados: EstadoRegistro[] = [];
    const r = await ejecutarRegistro(
      { code: "C", estado: estadoInicial() },
      deps(fetchFalso as never, guardados),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reanudableEn).toBe("verificar_permisos");
    expect(r.mensaje).toContain("whatsapp_business_management");
    expect(r.estado.ultimoError?.paso).toBe("verificar_permisos");
  });

  it("sin código y sin token no puede empezar", async () => {
    const r = await ejecutarRegistro(
      { estado: estadoInicial() },
      deps(metaFalso().fetchFalso as never, []),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reanudableEn).toBe("intercambiar_codigo");
  });

  it("los pasos están declarados en orden de dependencia", () => {
    expect([...PASOS_REGISTRO]).toEqual([
      "intercambiar_codigo",
      "verificar_permisos",
      "suscribir_app",
      "registrar_numero",
      "leer_estado",
      "completado",
    ]);
  });
});

describe("PIN de dos pasos", () => {
  it("son siempre seis dígitos, incluidos los que empiezan por cero", () => {
    for (let i = 0; i < 200; i++) expect(generarPinPorDefecto()).toMatch(/^\d{6}$/);
  });
});

describe("normalización del estado de pago", () => {
  it("una WABA con financiación se considera activa", () => {
    expect(normalizarPago({ primary_funding_id: "9988776655" })).toBe("active");
  });
  it("sin financiación pero con estado declarado, no hay método de pago", () => {
    expect(normalizarPago({ account_status: "" })).toBe("no_payment_method");
  });
  it("sin ningún dato, no se inventa nada", () => {
    expect(normalizarPago({})).toBe("unknown");
  });
  it("reconoce suspensión y mora", () => {
    expect(normalizarPago({ account_status: "SUSPENDED" })).toBe("suspended");
    expect(normalizarPago({ account_status: "PAST_DUE" })).toBe("past_due");
  });
});

describe("URL del flujo de conexión", () => {
  it("lleva config_id y state y usa la única constante de versión", () => {
    const url = urlEmbeddedSignup({
      appId: "111",
      configId: "222",
      redirectUri: "https://app.strappy.co/whatsapp/callback",
      state: "ws_1:nonce",
    });
    expect(url).toContain("config_id=222");
    expect(url).toContain("state=ws_1%3Anonce");
    expect(url).toContain("response_type=code");
  });
});
