import { describe, expect, it } from "vitest";
import {
  CONFIG_COBRO_POR_DEFECTO as D,
  cotizar,
  creditosPorUsd,
  decidirCobroAutomatico,
  decidirTransaccion,
  normalizarConfigCobro,
  validarConfigCobro,
  validarMonto,
  type EstadoRecarga,
} from "./index";
import { eventoAutentico, firmaDeIntegridad, transaccionDelEvento, urlDeCheckout, validarLlaves } from "./wompi";

describe("monto de la recarga", () => {
  it("el mínimo son 15 USD y solo enteros", () => {
    expect(validarMonto(15)).toEqual({ ok: true, usd: 15 });
    expect(validarMonto("300")).toEqual({ ok: true, usd: 300 });
    expect(validarMonto(14).ok).toBe(false);
    expect(validarMonto(15.5).ok).toBe(false);
    expect(validarMonto("").ok).toBe(false);
    expect(validarMonto(null).ok).toBe(false);
    expect(validarMonto(5_001).ok).toBe(false);
  });

  it("1 USD son 1.000 créditos", () => {
    expect(creditosPorUsd(15)).toBe(15_000);
  });

  it("cotiza en pesos enteros, redondeando hacia arriba", () => {
    // 15 × 3.235,59 = 48.533,85 → 48.534 pesos.
    expect(cotizar(15, 3235.59)).toEqual({
      usd: 15,
      creditos: 15_000,
      trm: 3235.59,
      pesos: 48_534,
      centavos: 4_853_400,
    });
  });
});

describe("firma de integridad", () => {
  it("coincide con el ejemplo de la documentación de Wompi", () => {
    expect(
      firmaDeIntegridad({
        referencia: "sk8-438k4-xmxm392-sn2m",
        centavos: 2490000,
        moneda: "COP",
        secreto: "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6",
      }),
    ).toBe("37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5");
  });

  it("la URL de pago lleva la firma y no el secreto", () => {
    const url = urlDeCheckout({
      llavePublica: "pub_test_x",
      secretoIntegridad: "test_integrity_secreto",
      referencia: "ref-1",
      centavos: 100,
      urlDeRetorno: "https://www.strappy.io/ajustes/facturacion",
    });
    expect(url).toContain("signature%3Aintegrity=");
    expect(url).not.toContain("secreto");
  });
});

describe("eventos de Wompi", () => {
  const evento = {
    event: "transaction.updated",
    data: {
      transaction: {
        id: "1234-1610641025-49201",
        amount_in_cents: 4490000,
        reference: "MZQ3X2DE2SMX",
        currency: "COP",
        payment_method_type: "NEQUI",
        status: "APPROVED",
      },
    },
    signature: {
      properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      // SHA-256 de id + estado + centavos + timestamp + secreto, calculado aparte con
      // `shasum`. El resultado impreso en la documentación de Wompi no sale de sus
      // propios datos de ejemplo: es ilustrativo, así que no sirve de referencia.
      checksum: "5A18EC5E8FDB7DF463E9F94774CBA8F583BA21BD04A09CEFF2EA68A4BC0AEFBE",
    },
    timestamp: 1530291411,
  };
  const secreto = "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z";

  it("acepta un evento firmado con la fórmula documentada, en mayúsculas o minúsculas", () => {
    expect(eventoAutentico(evento, secreto)).toBe(true);
    expect(eventoAutentico(evento, secreto, evento.signature.checksum.toLowerCase())).toBe(true);
  });

  it("rechaza un importe alterado, otro secreto o un evento sin firma", () => {
    const alterado = structuredClone(evento);
    alterado.data.transaction.amount_in_cents = 1;
    expect(eventoAutentico(alterado, secreto)).toBe(false);
    expect(eventoAutentico(evento, "otro")).toBe(false);
    expect(eventoAutentico(evento, "")).toBe(false);
    expect(eventoAutentico({ ...evento, signature: undefined }, secreto)).toBe(false);
  });

  it("solo lee transacciones", () => {
    expect(transaccionDelEvento(evento)?.referencia).toBe("MZQ3X2DE2SMX");
    expect(transaccionDelEvento({ ...evento, event: "nequi_token.updated" })).toBeNull();
  });
});

describe("qué hacer con cada transacción", () => {
  const orden = { centavos: 1000, moneda: "COP", abonada: false };
  const aprobada = { estado: "APPROVED", centavos: 1000, moneda: "COP" };

  it("abona lo aprobado por el importe cotizado", () => {
    expect(decidirTransaccion(orden, aprobada).tipo).toBe("abonar");
  });

  it("un evento repetido no abona dos veces", () => {
    expect(decidirTransaccion({ ...orden, abonada: true }, aprobada).tipo).toBe("nada");
  });

  it("no abona si el importe o la moneda no son los cotizados", () => {
    expect(decidirTransaccion(orden, { ...aprobada, centavos: 1 }).tipo).toBe("importe_distinto");
    expect(decidirTransaccion(orden, { ...aprobada, moneda: "USD" }).tipo).toBe("importe_distinto");
  });

  it("un rechazo tardío no borra un abono ya hecho, y una anulación lo señala", () => {
    const abonada = { ...orden, abonada: true };
    expect(decidirTransaccion(abonada, { ...aprobada, estado: "DECLINED" }).tipo).toBe("nada");
    expect(decidirTransaccion(abonada, { ...aprobada, estado: "VOIDED" }).tipo).toBe("revertida_tras_abonar");
  });

  it("lo pendiente no mueve nada", () => {
    expect(decidirTransaccion(orden, { ...aprobada, estado: "PENDING" }).tipo).toBe("nada");
  });
});

describe("cuándo cargar la tarjeta", () => {
  const ahora = new Date("2026-11-04T12:00:00Z");
  const hace = (minutos: number) => new Date(ahora.getTime() - minutos * 60_000);
  const decidir = (recientes: { estado: EstadoRecarga; creadaEn: Date }[], disponible = 0) =>
    decidirCobroAutomatico({ disponible, recientes, ahora });

  it("con saldo no cobra; con un pico que no cubre nada, sí", () => {
    expect(decidir([], D.umbralSaldoAcabado).tipo).toBe("esperar");
    expect(decidir([], D.umbralSaldoAcabado - 1).tipo).toBe("cobrar");
  });

  it("con una orden en vuelo no vuelve a cobrar", () => {
    expect(decidir([{ estado: "pending", creadaEn: hace(5) }]).tipo).toBe("esperar");
  });

  it("tras un rechazo espera una hora antes de reintentar", () => {
    expect(decidir([{ estado: "declined", creadaEn: hace(10) }]).tipo).toBe("esperar");
    expect(decidir([{ estado: "declined", creadaEn: hace(61) }]).tipo).toBe("cobrar");
  });

  it("tres rechazos seguidos la apagan", () => {
    const rechazos = [hace(70), hace(200), hace(400)].map((creadaEn) => ({ estado: "declined" as const, creadaEn }));
    expect(decidir(rechazos)).toEqual({ tipo: "apagar", motivo: "tarjeta_rechazada" });
  });

  it("un cobro aprobado reinicia la cuenta de rechazos", () => {
    const recientes = [
      { estado: "declined" as const, creadaEn: hace(70) },
      { estado: "approved" as const, creadaEn: hace(200) },
      { estado: "declined" as const, creadaEn: hace(300) },
      { estado: "declined" as const, creadaEn: hace(400) },
    ];
    expect(decidir(recientes).tipo).toBe("cobrar");
  });

  it("demasiados cobros en un día la apagan", () => {
    const cobros = Array.from({ length: D.cobrosPorDia }, (_, i) => ({
      estado: "approved" as const,
      creadaEn: hace(60 * (i + 1)),
    }));
    expect(decidir(cobros)).toEqual({ tipo: "apagar", motivo: "tope_diario" });
  });
});

describe("la configuración del panel manda", () => {
  const ahora = new Date("2026-11-04T12:00:00Z");

  it("el mínimo y el umbral salen de lo guardado", () => {
    const config = { ...D, minimoUsd: 30, umbralSaldoAcabado: 200 };
    expect(validarMonto(20, config).ok).toBe(false);
    expect(decidirCobroAutomatico({ disponible: 500, recientes: [], ahora, config }).tipo).toBe("esperar");
    expect(decidirCobroAutomatico({ disponible: 100, recientes: [], ahora, config }).tipo).toBe("cobrar");
  });

  it("un dato guardado raro cae al valor por defecto, campo por campo", () => {
    const c = normalizarConfigCobro({ minimoUsd: "basura", maximoUsd: 900, montosAutomaticos: "nada" });
    expect(c.minimoUsd).toBe(D.minimoUsd);
    expect(c.maximoUsd).toBe(900);
    expect(c.montosAutomaticos).toEqual(D.montosAutomaticos);
    expect(normalizarConfigCobro(null)).toEqual(D);
  });

  it("lo que escribe el super admin sí se rechaza si no tiene sentido", () => {
    const base = {
      minimoUsd: "15",
      maximoUsd: "5000",
      montosAutomaticos: "100, 20,20",
      umbralSaldoAcabado: "1000",
      umbralAviso: "5000",
      rechazosParaApagar: "3",
      esperaTrasRechazoMin: "60",
      cobrosPorDia: "5",
    };
    const bien = validarConfigCobro(base);
    expect(bien.ok && bien.config.montosAutomaticos).toEqual([20, 100]);
    expect(validarConfigCobro({ ...base, maximoUsd: "10" }).ok).toBe(false);
    expect(validarConfigCobro({ ...base, montosAutomaticos: "10" }).ok).toBe(false);
    expect(validarConfigCobro({ ...base, cobrosPorDia: "0" }).ok).toBe(false);
  });
});

describe("llaves de Wompi", () => {
  const pruebas = { publica: "pub_test_a", privada: "prv_test_b", integridad: "test_integrity_c", eventos: "test_events_d" };

  it("reconoce el ambiente", () => {
    expect(validarLlaves(pruebas)).toEqual({ ok: true, ambiente: "pruebas" });
  });

  it("no deja mezclar ambientes ni llaves en la casilla equivocada", () => {
    expect(validarLlaves({ ...pruebas, privada: "prv_prod_b" }).ok).toBe(false);
    expect(validarLlaves({ ...pruebas, publica: "prv_test_b" }).ok).toBe(false);
  });
});
