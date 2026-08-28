import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  extraerEventos,
  hashEvento,
  recibirWebhook,
  verificarChallenge,
  verificarFirma,
  type EventoWebhook,
  type PuertosWebhook,
} from "../src/webhook.js";
import { crudo } from "./fixtures.js";

const APP_SECRET = "un_secreto_de_app_de_meta";

const firmar = (cuerpo: string, secreto = APP_SECRET) =>
  `sha256=${createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex")}`;

describe("verificación de la firma X-Hub-Signature-256", () => {
  const cuerpo = crudo("inbound-texto");

  it("acepta una firma válida calculada sobre el cuerpo crudo", () => {
    expect(verificarFirma({ cuerpoCrudo: cuerpo, cabecera: firmar(cuerpo), appSecret: APP_SECRET })).toBe(true);
  });

  it("rechaza una firma calculada con otro secreto", () => {
    const ajena = firmar(cuerpo, "secreto_de_otro");
    expect(verificarFirma({ cuerpoCrudo: cuerpo, cabecera: ajena, appSecret: APP_SECRET })).toBe(false);
  });

  it("rechaza el cuerpo alterado aunque la firma sea la del original", () => {
    const firma = firmar(cuerpo);
    const alterado = cuerpo.replace("573009998877", "573001234567");
    expect(alterado).not.toBe(cuerpo);
    expect(verificarFirma({ cuerpoCrudo: alterado, cabecera: firma, appSecret: APP_SECRET })).toBe(false);
  });

  it("rechaza el JSON reserializado: la firma es sobre los bytes exactos", () => {
    // Este es EL error clásico: firmar sobre `JSON.stringify(req.body)`.
    const reserializado = JSON.stringify(JSON.parse(cuerpo));
    expect(verificarFirma({ cuerpoCrudo: reserializado, cabecera: firmar(cuerpo), appSecret: APP_SECRET })).toBe(false);
  });

  it("rechaza cabeceras ausentes, mal formadas o de otro algoritmo", () => {
    for (const cabecera of [null, undefined, "", "sha1=abc", "sha256=", "sha256=nohex", firmar(cuerpo).slice(0, -2)]) {
      expect(verificarFirma({ cuerpoCrudo: cuerpo, cabecera, appSecret: APP_SECRET })).toBe(false);
    }
  });

  it("rechaza si falta el secreto de la app", () => {
    expect(verificarFirma({ cuerpoCrudo: cuerpo, cabecera: firmar(cuerpo), appSecret: "" })).toBe(false);
  });
});

describe("verificación del hub.challenge", () => {
  it("devuelve el challenge cuando el token coincide", () => {
    const r = verificarChallenge({
      query: { "hub.mode": "subscribe", "hub.verify_token": "token_bueno", "hub.challenge": "1158201444" },
      verifyToken: "token_bueno",
    });
    expect(r).toEqual({ ok: true, challenge: "1158201444" });
  });

  it("rechaza un token distinto", () => {
    const r = verificarChallenge({
      query: new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "malo", "hub.challenge": "x" }),
      verifyToken: "token_bueno",
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza un modo distinto de subscribe", () => {
    const r = verificarChallenge({
      query: { "hub.mode": "unsubscribe", "hub.verify_token": "token_bueno", "hub.challenge": "x" },
      verifyToken: "token_bueno",
    });
    expect(r.ok).toBe(false);
  });
});

describe("hash del evento y extracción", () => {
  it("un mensaje y sus recibos comparten wamid pero NO hash", () => {
    const mensaje = hashEvento({ externalId: "wamid.A", tipo: "message" });
    const entregado = hashEvento({ externalId: "wamid.A", tipo: "status.delivered" });
    const leido = hashEvento({ externalId: "wamid.A", tipo: "status.read" });
    expect(new Set([mensaje, entregado, leido]).size).toBe(3);
  });

  it("el mismo evento produce siempre el mismo hash", () => {
    expect(hashEvento({ externalId: "wamid.A", tipo: "message" })).toBe(
      hashEvento({ externalId: "wamid.A", tipo: "message" }),
    );
  });

  it("extrae la clave de enrutado y un evento por mensaje y por estado", () => {
    const eventos = extraerEventos(JSON.parse(crudo("statuses-desordenados")));
    expect(eventos).toHaveLength(3);
    expect(eventos.every((e) => e.externalKey === "106540352242922")).toBe(true);
    expect(eventos.map((e) => e.tipo)).toEqual(["status.read", "status.sent", "status.delivered"]);
  });
});

/** Puertos en memoria que imitan el único sobre `event_hash` de `webhook_events`. */
function puertosDePrueba(): PuertosWebhook & { vistos: Set<string>; encolados: EventoWebhook[] } {
  const vistos = new Set<string>();
  const encolados: EventoWebhook[] = [];
  return {
    vistos,
    encolados,
    async registrarEvento(evento) {
      if (vistos.has(evento.eventHash)) return false;
      vistos.add(evento.eventHash);
      return true;
    },
    async encolar(evento) {
      encolados.push(evento);
    },
  };
}

describe("handler del webhook", () => {
  it("verifica, deduplica, encola y devuelve 200", async () => {
    const cuerpo = crudo("inbound-texto");
    const puertos = puertosDePrueba();
    const r = await recibirWebhook({
      cuerpoCrudo: cuerpo,
      cabeceraFirma: firmar(cuerpo),
      appSecret: APP_SECRET,
      puertos,
    });
    expect(r.status).toBe(200);
    expect(r.encolados).toHaveLength(1);
    expect(puertos.encolados[0]?.externalId).toContain("wamid.");
  });

  it("un mismo wamid reenviado por Meta no se encola dos veces", async () => {
    const cuerpo = crudo("inbound-texto");
    const puertos = puertosDePrueba();
    const entrada = { cuerpoCrudo: cuerpo, cabeceraFirma: firmar(cuerpo), appSecret: APP_SECRET, puertos };

    const primera = await recibirWebhook(entrada);
    const segunda = await recibirWebhook(entrada);

    expect(primera.encolados).toHaveLength(1);
    expect(segunda.encolados).toHaveLength(0);
    expect(segunda.duplicados).toHaveLength(1);
    expect(segunda.status).toBe(200);
    expect(puertos.encolados).toHaveLength(1);
  });

  it("con firma inválida responde 401 y no toca la base de datos", async () => {
    const cuerpo = crudo("inbound-texto");
    const puertos = puertosDePrueba();
    const registrar = vi.spyOn(puertos, "registrarEvento");
    const r = await recibirWebhook({
      cuerpoCrudo: cuerpo,
      cabeceraFirma: firmar(cuerpo, "otro_secreto"),
      appSecret: APP_SECRET,
      puertos,
    });
    expect(r.status).toBe(401);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("un fallo interno NO se propaga como 5xx: Meta desactivaría el webhook de la WABA", async () => {
    const cuerpo = crudo("inbound-texto");
    const fallos: unknown[] = [];
    const r = await recibirWebhook({
      cuerpoCrudo: cuerpo,
      cabeceraFirma: firmar(cuerpo),
      appSecret: APP_SECRET,
      puertos: {
        async registrarEvento() {
          throw new Error("la base de datos está caída");
        },
        async encolar() {},
        registrarFallo: (e) => fallos.push(e),
      },
    });
    expect(r.status).toBe(200);
    expect(fallos).toHaveLength(1);
  });

  it("un cuerpo que no es JSON válido tampoco produce 5xx", async () => {
    const cuerpo = "esto no es json";
    const r = await recibirWebhook({
      cuerpoCrudo: cuerpo,
      cabeceraFirma: firmar(cuerpo),
      appSecret: APP_SECRET,
      puertos: puertosDePrueba(),
    });
    expect(r.status).toBe(200);
    expect(r.encolados).toHaveLength(0);
  });
});
