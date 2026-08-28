import type { ChannelContext, DeliveryStatus, OutboundMessage } from "@strappy/core";
import { describe, expect, it, vi } from "vitest";
import {
  aplicarRecibos,
  crearAdaptadorWhatsApp,
  finDeVentanaTras,
  normalizarEntrantes,
  normalizarRecibos,
  type EstadoConversacion,
} from "../src/adapter.js";
import { crearClienteWhatsApp } from "../src/client.js";
import { WhatsAppApiError } from "../src/errors.js";
import { CODIGO_VENTANA_CERRADA, VENTANA_SERVICIO_MS } from "../src/window.js";
import { fixture } from "./fixtures.js";

const AHORA = new Date("2026-08-27T12:00:00.000Z");

const ctx = (extra: Record<string, string> = {}): ChannelContext => ({
  workspaceId: "ws_1",
  channelId: "ch_1",
  credentials: { accessToken: "token_del_cliente", phoneNumberId: "106540352242922", ...extra },
});

function adaptador(opciones: {
  estado?: EstadoConversacion | null;
  fetch?: typeof globalThis.fetch;
  alRevocarseElToken?: (input: { ctx: ChannelContext; error: WhatsAppApiError }) => Promise<void>;
  alPausarLaCola?: (input: { ctx: ChannelContext; error: WhatsAppApiError }) => Promise<void>;
}) {
  return crearAdaptadorWhatsApp({
    now: () => AHORA,
    async leerEstadoConversacion() {
      return opciones.estado ?? null;
    },
    limitador: { async adquirir() {} },
    ...(opciones.alRevocarseElToken ? { alRevocarseElToken: opciones.alRevocarseElToken } : {}),
    ...(opciones.alPausarLaCola ? { alPausarLaCola: opciones.alPausarLaCola } : {}),
    crearCliente: (cred) =>
      crearClienteWhatsApp({
        accessToken: cred.accessToken,
        maxIntentos: 1,
        dormir: async () => {},
        fetch: (opciones.fetch ?? (async () => respuesta(200, fixture("envio-ok")))) as never,
      }),
  });
}

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseInbound: normalización de los eventos de Meta", () => {
  it("normaliza un mensaje de texto con nombre de contacto y reloj del proveedor", async () => {
    const [m] = await adaptador({}).parseInbound(fixture("inbound-texto"), ctx());
    expect(m?.externalContactId).toBe("573009998877");
    expect(m?.contactName).toBe("María José Peña");
    expect(m?.content).toEqual({ kind: "text", text: "Hola, ¿tienen disponibilidad para mañana?" });
    // Meta manda segundos epoch, no milisegundos.
    expect(m?.sentAt.toISOString()).toBe(new Date(1756300800 * 1000).toISOString());
    expect(m?.raw).toBeTruthy();
  });

  it("cubre todos los tipos entrantes", () => {
    const mensajes = normalizarEntrantes(fixture("inbound-todos-los-tipos"));
    const porId = Object.fromEntries(mensajes.map((m) => [m.externalId, m.content]));

    expect(porId["wamid.IMG1"]).toEqual({ kind: "image", mediaId: "media_img_1", caption: "Aquí está la foto" });
    expect(porId["wamid.AUD1"]).toEqual({ kind: "audio", mediaId: "media_aud_1" });
    expect(porId["wamid.VID1"]).toEqual({ kind: "video", mediaId: "media_vid_1", caption: "Mira esto" });
    expect(porId["wamid.DOC1"]).toEqual({ kind: "document", mediaId: "media_doc_1", filename: "cotización.pdf" });
    expect(porId["wamid.STK1"]).toMatchObject({ kind: "image", mediaId: "media_stk_1" });
    expect(porId["wamid.LOC1"]).toEqual({ kind: "location", latitude: 4.710989, longitude: -74.07209, label: "Bogotá" });
    expect(porId["wamid.CON1"]).toMatchObject({ kind: "unsupported" });
    expect((porId["wamid.CON1"] as { describedAs: string }).describedAs).toContain("Luis Fernández");
    // Un botón pulsado llega al motor como el texto que la persona vio.
    expect(porId["wamid.INT1"]).toEqual({ kind: "text", text: "Sí, confirmo" });
    expect(porId["wamid.LST1"]).toEqual({ kind: "text", text: "Corte de cabello" });
    expect(porId["wamid.REA1"]).toMatchObject({ kind: "unsupported" });
    expect((porId["wamid.REA1"] as { describedAs: string }).describedAs).toContain("👍");
  });

  it("conserva la referencia al mensaje citado", () => {
    const mensajes = normalizarEntrantes(fixture("inbound-todos-los-tipos"));
    const respuesta = mensajes.find((m) => m.externalId === "wamid.RESP1");
    expect(respuesta?.replyToExternalId).toBe("wamid.SALIENTE1");
  });

  it("tolera cargas vacías o de otro tipo sin reventar", () => {
    expect(normalizarEntrantes(null)).toEqual([]);
    expect(normalizarEntrantes({})).toEqual([]);
    expect(normalizarEntrantes(fixture("statuses-desordenados"))).toEqual([]);
  });
});

describe("canSend: la ventana de 24 horas vive en el adaptador", () => {
  it("permite escribir mientras la ventana sigue abierta", async () => {
    const abierta = new Date(AHORA.getTime() + 60_000);
    const politica = await adaptador({ estado: { enviarLibreHasta: abierta } }).canSend({
      ...ctx(),
      conversationId: "conv_1",
    });
    expect(politica).toEqual({ allowed: true });
  });

  it("bloquea con la ventana cerrada y ofrece la plantilla como alternativa", async () => {
    const cerrada = new Date(AHORA.getTime() - 60_000);
    const politica = await adaptador({ estado: { enviarLibreHasta: cerrada } }).canSend({
      ...ctx(),
      conversationId: "conv_1",
    });
    expect(politica.allowed).toBe(false);
    if (politica.allowed) return;
    expect(politica.restriction.code).toBe(CODIGO_VENTANA_CERRADA);
    expect(politica.restriction.expiresAt).toEqual(cerrada);
    expect(politica.restriction.alternative).toEqual({
      kind: "plantilla",
      label: "Enviar una plantilla aprobada",
    });
    // El texto va ya redactado: la bandeja lo muestra tal cual.
    expect(politica.restriction.message).toContain("24 horas");
    expect(politica.restriction.message).toContain("plantilla aprobada");
  });

  it("bloquea cuando nunca hubo mensaje entrante", async () => {
    const politica = await adaptador({ estado: { enviarLibreHasta: null } }).canSend({
      ...ctx(),
      conversationId: "conv_1",
    });
    expect(politica.allowed).toBe(false);
  });

  it("bloquea si el número está pausado o desconectado, con motivo distinto", async () => {
    const abierta = new Date(AHORA.getTime() + 60_000);
    for (const estadoNumero of ["paused", "disconnected"] as const) {
      const politica = await adaptador({
        estado: { enviarLibreHasta: abierta, estadoNumero },
      }).canSend({ ...ctx(), conversationId: "conv_1" });
      expect(politica.allowed).toBe(false);
      if (politica.allowed) continue;
      expect(politica.restriction.code).toBe("whatsapp.numero_pausado");
    }
  });

  it("el fin de ventana se calcula 24 h después del último entrante", () => {
    const [m] = normalizarEntrantes(fixture("inbound-texto"));
    expect(m).toBeTruthy();
    expect(finDeVentanaTras(m!).getTime() - m!.sentAt.getTime()).toBe(VENTANA_SERVICIO_MS);
  });
});

describe("parseReceipts: recibos desordenados", () => {
  it("normaliza los tres estados con el reloj de Meta", async () => {
    const recibos = await adaptador({}).parseReceipts!(fixture("statuses-desordenados"), ctx());
    expect(recibos.map((r) => r.status)).toEqual(["read", "sent", "delivered"]);
    expect(recibos.every((r) => r.externalId === "wamid.SALIENTE1")).toBe(true);
  });

  it("aplicados con monotonía nunca retroceden, llegue el orden que llegue", () => {
    const recibos = normalizarRecibos(fixture("statuses-desordenados"));
    const { estado, aplicados } = aplicarRecibos(null, recibos);
    expect(estado).toBe("read");
    // "read" llegó primero en la carga pero es el último por reloj: solo se
    // aplican los que suponen progreso.
    expect(aplicados.map((r) => r.status)).toEqual(["sent", "delivered", "read"]);
  });

  it("un recibo tardío no rebaja un estado ya avanzado", () => {
    const recibos = normalizarRecibos(fixture("statuses-desordenados"));
    const { estado } = aplicarRecibos("read", recibos);
    expect(estado).toBe("read");
  });

  it("cualquier permutación converge al mismo estado final", () => {
    const recibos = normalizarRecibos(fixture("statuses-desordenados"));
    const permutaciones = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [1, 2, 0],
    ];
    for (const orden of permutaciones) {
      const { estado } = aplicarRecibos(null, orden.map((i) => recibos[i]!));
      expect(estado).toBe<DeliveryStatus>("read");
    }
  });

  it("un fallo llega con código y mensaje en español y no se revierte", () => {
    const [recibo] = normalizarRecibos(fixture("status-fallido"));
    expect(recibo?.status).toBe("failed");
    expect(recibo?.error?.code).toBe("131047");
    const { estado } = aplicarRecibos("failed", normalizarRecibos(fixture("statuses-desordenados")));
    expect(estado).toBe("failed");
  });
});

describe("send", () => {
  const mensaje = (contenido: OutboundMessage["content"]): OutboundMessage => ({
    conversationId: "conv_1",
    externalContactId: "573009998877",
    content: contenido,
  });

  it("envía texto y devuelve el identificador de Meta", async () => {
    const llamadas: { url: string; body: unknown }[] = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, body: JSON.parse(String(init.body)) });
      return respuesta(200, fixture("envio-ok"));
    }) as unknown as typeof globalThis.fetch;

    const r = await adaptador({ fetch: fetchFalso }).send(mensaje({ kind: "text", text: "Hola" }), ctx());
    expect(r.externalId).toContain("wamid.");
    expect(llamadas[0]?.url).toContain("/106540352242922/messages");
    expect(llamadas[0]?.body).toMatchObject({ messaging_product: "whatsapp", type: "text" });
  });

  it("más de 3 botones se convierten en lista: el motor no conoce ese límite", async () => {
    const cuerpos: Record<string, unknown>[] = [];
    const fetchFalso = (async (_url: string, init: RequestInit) => {
      cuerpos.push(JSON.parse(String(init.body)));
      return respuesta(200, fixture("envio-ok"));
    }) as unknown as typeof globalThis.fetch;

    const ad = adaptador({ fetch: fetchFalso });
    const opciones = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Opción ${i}` }));

    await ad.send(mensaje({ kind: "buttons", text: "Elige", options: opciones(3) }), ctx());
    await ad.send(mensaje({ kind: "buttons", text: "Elige", options: opciones(5) }), ctx());

    expect((cuerpos[0] as { interactive: { type: string } }).interactive.type).toBe("button");
    expect((cuerpos[1] as { interactive: { type: string } }).interactive.type).toBe("list");
  });

  it("un 190 marca la cuenta revocada y pausa la cola del cliente", async () => {
    const alRevocarseElToken = vi.fn(async () => {});
    const fetchFalso = (async () => respuesta(401, fixture("error-190"))) as unknown as typeof globalThis.fetch;

    await expect(
      adaptador({ fetch: fetchFalso, alRevocarseElToken }).send(mensaje({ kind: "text", text: "Hola" }), ctx()),
    ).rejects.toBeInstanceOf(WhatsAppApiError);

    expect(alRevocarseElToken).toHaveBeenCalledTimes(1);
  });

  it("un 131047 no revoca nada: solo dice que hace falta plantilla", async () => {
    const alRevocarseElToken = vi.fn(async () => {});
    const alPausarLaCola = vi.fn(async () => {});
    const fetchFalso = (async () => respuesta(400, fixture("error-131047"))) as unknown as typeof globalThis.fetch;

    await expect(
      adaptador({ fetch: fetchFalso, alRevocarseElToken, alPausarLaCola }).send(
        mensaje({ kind: "text", text: "Hola" }),
        ctx(),
      ),
    ).rejects.toMatchObject({ decision: { accion: "requiere_plantilla" } });

    expect(alRevocarseElToken).not.toHaveBeenCalled();
    expect(alPausarLaCola).not.toHaveBeenCalled();
  });

  it("exige credenciales del contexto: nunca hay nada codificado", async () => {
    const ad = adaptador({});
    await expect(
      ad.send(mensaje({ kind: "text", text: "Hola" }), {
        workspaceId: "ws_1",
        channelId: "ch_1",
        credentials: {},
      }),
    ).rejects.toThrow(/token de acceso/i);
  });
});
