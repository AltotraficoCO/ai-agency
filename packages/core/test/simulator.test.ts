import { describe, expect, it } from "vitest";
import { createSimulatorChannel } from "../src/channels/simulator.js";
import type { ChannelAdapter, ChannelContext } from "../src/registry/channel.js";

const ctx: ChannelContext & { conversationId: string } = {
  workspaceId: "ws_1",
  channelId: "ch_1",
  credentials: {},
  conversationId: "conv_1",
};

describe("canal simulador", () => {
  it("es un ChannelAdapter completo, no un modo de prueba", () => {
    const sim: ChannelAdapter = createSimulatorChannel();
    expect(typeof sim.parseInbound).toBe("function");
    expect(typeof sim.send).toBe("function");
    expect(typeof sim.canSend).toBe("function");
    expect(sim.capabilities).toContain("text");
  });

  it("canSend siempre permite: aquí no hay ventanas ni plantillas", async () => {
    const sim = createSimulatorChannel();
    await expect(sim.canSend(ctx)).resolves.toEqual({ allowed: true });
  });

  it("el transporte es un callback en memoria", async () => {
    const recibidos: string[] = [];
    const sim = createSimulatorChannel({
      onOutbound: (s) => {
        if (s.message.content.kind === "text") recibidos.push(s.message.content.text);
      },
    });
    const { externalId } = await sim.send(
      { conversationId: "conv_1", externalContactId: "c1", content: { kind: "text", text: "hola" } },
      ctx,
    );
    expect(externalId).toMatch(/^sim_out_/);
    expect(recibidos).toEqual(["hola"]);
    expect(sim.sent).toHaveLength(1);
  });

  it("emite entrantes ya normalizados", () => {
    const sim = createSimulatorChannel();
    const msg = sim.emit({ text: "¿tienen talla 40?", contactName: "Ana" });
    expect(msg.content).toEqual({ kind: "text", text: "¿tienen talla 40?" });
    expect(msg.contactName).toBe("Ana");
    expect(msg.externalId).toMatch(/^sim_in_/);
  });

  it("declara que los efectos externos van en seco", () => {
    expect(createSimulatorChannel().execution.sideEffects).toBe("dry_run");
  });

  it("entrega recibos para que la bandeja se comporte igual que con un canal real", async () => {
    const recibos: string[] = [];
    const sim = createSimulatorChannel({ onReceipt: (r) => void recibos.push(r.status) });
    await sim.send(
      { conversationId: "conv_1", externalContactId: "c1", content: { kind: "text", text: "hola" } },
      ctx,
    );
    expect(recibos).toEqual(["delivered"]);
  });
});
