import { describe, expect, it } from "vitest";
import { CONFIG_COBRO_POR_DEFECTO, type EstadoRecarga, type MotivoApagado } from "@strappy/core/recargas";
import type { ResultadoCobro } from "@strappy/core/wompi";
import { ConsumidorDeRecargasAutomaticas, type RecargasAutomaticasPort } from "../src/consumers/recargas.js";

function montar(opciones: {
  disponible?: number;
  recientes?: { estado: EstadoRecarga; creadaEn: Date }[];
  ordenLibre?: boolean;
  trm?: number | null;
  cobro?: ResultadoCobro;
  sinLlaves?: boolean;
}) {
  const cobros: { centavos: number; referencia: string }[] = [];
  const fallidas: string[] = [];
  const apagados: MotivoApagado[] = [];
  const llaves = {
    publica: "pub_test_a",
    privada: opciones.sinLlaves ? "" : "prv_test_b",
    integridad: opciones.sinLlaves ? "" : "test_integrity_c",
    eventos: "test_events_d",
  };
  const recargas: RecargasAutomaticasPort = {
    ajustes: async () => ({ config: CONFIG_COBRO_POR_DEFECTO, llaves }),
    candidatas: async () => [
      { workspaceId: "w1", usd: 20, fuenteDePago: 3891, correo: "a@b.co", disponible: opciones.disponible ?? 0 },
    ],
    recientes: async () => opciones.recientes ?? [],
    crearOrden: async () => (opciones.ordenLibre === false ? null : { referencia: "ref-1" }),
    marcarFallida: async (referencia) => {
      fallidas.push(referencia);
    },
    caducarPendientes: async () => {},
    apagar: async (_w, motivo) => {
      apagados.push(motivo);
    },
  };
  const consumidor = new ConsumidorDeRecargasAutomaticas({
    recargas,
    obtenerTrm: async () => (opciones.trm === undefined ? 4000 : opciones.trm),
    cobrar: async (c) => {
      cobros.push(c);
      return opciones.cobro ?? { tipo: "aceptado", id: "t1", estado: "PENDING" };
    },
  });
  return { consumidor, cobros, fallidas, apagados };
}

describe("recarga automática", () => {
  it("con el saldo acabado cobra el monto elegido, en pesos a la TRM", async () => {
    const { consumidor, cobros } = montar({});
    expect(await consumidor.tick()).toBe(true);
    expect(cobros).toEqual([expect.objectContaining({ centavos: 8_000_000, referencia: "ref-1" })]);
  });

  it("si otro proceso creó la orden, no llama a Wompi", async () => {
    const { consumidor, cobros } = montar({ ordenLibre: false });
    expect(await consumidor.tick()).toBe(false);
    expect(cobros).toEqual([]);
  });

  it("sin llaves en el panel no cobra", async () => {
    const { consumidor, cobros } = montar({ sinLlaves: true });
    expect(await consumidor.tick()).toBe(false);
    expect(cobros).toEqual([]);
  });

  it("sin TRM no cobra", async () => {
    const { consumidor, cobros } = montar({ trm: null });
    await consumidor.tick();
    expect(cobros).toEqual([]);
  });

  it("un rechazo de Wompi marca la orden; un cobro incierto la deja pendiente", async () => {
    const rechazo = montar({ cobro: { tipo: "rechazado", motivo: "422" } });
    await rechazo.consumidor.tick();
    expect(rechazo.fallidas).toEqual(["ref-1"]);

    const incierto = montar({ cobro: { tipo: "incierto", motivo: "timeout" } });
    await incierto.consumidor.tick();
    expect(incierto.fallidas).toEqual([]);
  });

  it("tres rechazos la apagan sin volver a cobrar", async () => {
    const creadaEn = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { consumidor, cobros, apagados } = montar({
      recientes: [
        { estado: "declined", creadaEn },
        { estado: "declined", creadaEn },
        { estado: "declined", creadaEn },
      ],
    });
    await consumidor.tick();
    expect(apagados).toEqual(["tarjeta_rechazada"]);
    expect(cobros).toEqual([]);
  });
});
