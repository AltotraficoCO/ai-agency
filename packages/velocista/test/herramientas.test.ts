/**
 * Las herramientas, contra los dobles del medidor y del sitio.
 *
 * La promesa que se verifica aquí es una sola y es la que sostiene el producto:
 * el agente NO puede instalar nada en la web del cliente sin que una persona
 * pulse un botón, y nunca sin copia previa. Después, que no se salga del sitio
 * del cliente y que no opine sin medir.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import {
  velocidadActivarCache,
  velocidadComparar,
  velocidadMedir,
  velocidadRevisarImagenes,
  velocidadRevisarPlugins,
} from "../src/tools/index.js";
import { huellaAccion } from "../src/aprobacion.js";
import { SCOPES_VELOCISTA } from "../src/context.js";
import type { Medicion, VelocidadContext } from "../src/ports.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  MedidorEnMemoria,
  SitioEnMemoria,
  medicionLenta,
  medicionRapida,
} from "../src/testing/dobles.js";

const AHORA = new Date("2026-09-12T10:00:00.000Z");

function montar(
  o: {
    sitio?: SitioEnMemoria;
    medidor?: MedidorEnMemoria;
    sinSitio?: boolean;
    sinMedidor?: boolean;
  } = {},
) {
  const sitio = o.sitio ?? new SitioEnMemoria();
  const medidor = o.medidor ?? new MedidorEnMemoria();
  const approvals = new AprobacionesEnMemoria();
  const backups = new BackupsEnMemoria();
  const historial: Medicion[] = [];
  const velocidad: VelocidadContext = {
    conexionId: "con_1",
    taskId: "task_1",
    ...(o.sinSitio ? {} : { sitio }),
    ...(o.sinMedidor ? {} : { rendimiento: medidor }),
    approvals,
    backups,
    historial,
  };
  const ctx = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_VELOCISTA,
    ports: {},
    now: () => AHORA,
    velocidad,
  } as unknown as ToolContext;
  return { ctx, sitio, medidor, approvals, backups, velocidad, historial };
}

describe("medir", () => {
  it("mide en celular por defecto y explica de dónde sale la cifra", async () => {
    const { ctx, medidor } = montar();
    const r = (await velocidadMedir.execute(ctx, { ruta: "/", dispositivo: "movil" })) as {
      titular: string;
      lo_que_pasa: string[];
      de_donde_sale: string;
    };
    expect(medidor.llamadas[0]?.dispositivo).toBe("movil");
    expect(r.titular).toContain("celular");
    expect(r.de_donde_sale).toContain("gente que entró de verdad");
    expect(r.lo_que_pasa.join(" ")).not.toContain("LCP");
  });

  it("guarda la medición para poder comparar después", async () => {
    const { ctx, historial } = montar();
    await velocidadMedir.execute(ctx, { ruta: "/", dispositivo: "movil" });
    expect(historial).toHaveLength(1);
    expect(historial[0]?.url).toBe("https://negocio.com/");
  });

  it("no se sale del sitio del cliente aunque el modelo lo intente", async () => {
    const { ctx } = montar();
    await expect(
      velocidadMedir.execute(ctx, { ruta: "https://otro-dominio.com/", dispositivo: "movil" }),
    ).rejects.toThrow(/no puede apuntar a otro dominio/i);
    await expect(
      velocidadMedir.execute(ctx, { ruta: "//evil.com/", dispositivo: "movil" }),
    ).rejects.toThrow(/no puede apuntar a otro dominio/i);
  });

  it("sin medidor lo dice en vez de opinar a ojo", async () => {
    const { ctx } = montar({ sinMedidor: true });
    await expect(velocidadMedir.execute(ctx, { ruta: "/", dispositivo: "movil" })).rejects.toThrow(
      /sin medición no se opina/i,
    );
  });
});

describe("mirar el sitio", () => {
  it("señala las imágenes pesadas por su nombre y su peso", async () => {
    const { ctx } = montar();
    const r = (await velocidadRevisarImagenes.execute(ctx, {})) as {
      pesadas: { titulo: string; peso: string }[];
      resumen_legible: string;
      nota: string;
    };
    expect(r.pesadas[0]?.titulo).toBe("portada");
    expect(r.pesadas[0]?.peso).toBe("3,0 MB");
    expect(r.resumen_legible).toContain("se podrían ahorrar");
    // Honestidad sobre lo que este agente no hace.
    expect(r.nota).toContain("no comprimo imágenes");
  });

  it("dice que no hay caché y cuál instalaría", async () => {
    const { ctx } = montar();
    const r = (await velocidadRevisarPlugins.execute(ctx, {})) as {
      cache_activa: boolean;
      puedo_instalar_cache: string | null;
      nota: string;
    };
    expect(r.cache_activa).toBe(false);
    expect(r.puedo_instalar_cache).toBe("litespeed-cache");
    expect(r.nota).toContain("Nunca desactivo");
  });

  it("sin sitio conectado lo explica en vez de reventar con jerga", async () => {
    const { ctx } = montar({ sinSitio: true });
    await expect(velocidadRevisarPlugins.execute(ctx, {})).rejects.toThrow(/no lo tiene/i);
  });
});

describe("instalar la caché", () => {
  it("no instala nada sin que una persona lo apruebe", async () => {
    const { ctx, sitio, approvals, backups } = montar();
    const entrada = { plugin: "litespeed-cache", motivo: "Tu página tarda 4,8 segundos en celular." };
    const r = (await velocidadActivarCache.execute(ctx, entrada)) as { requiere_aprobacion?: boolean };

    expect(r.requiere_aprobacion).toBe(true);
    expect(sitio.escrituras()).toBe(0);
    // Ni siquiera se guarda copia: no se llegó a tocar nada.
    expect(backups.guardados).toHaveLength(0);
    expect(approvals.solicitudes).toHaveLength(1);
    // Lo que lee la persona dice qué gana y cómo se vuelve atrás.
    expect(approvals.solicitudes[0]?.resumen).toContain("LiteSpeed Cache");
    expect(approvals.solicitudes[0]?.resumen).toContain("vuelve a como estaba");
  });

  it("aprobada, instala y deja copia de los complementos antes", async () => {
    const { ctx, sitio, approvals, backups } = montar();
    const entrada = { plugin: "litespeed-cache", motivo: "Tu página tarda 4,8 segundos en celular." };
    approvals.decidir(huellaAccion("task_1", "velocidad_activar_cache", entrada), "aprobada");

    const r = (await velocidadActivarCache.execute(ctx, entrada)) as { activado?: boolean };

    expect(r.activado).toBe(true);
    expect(sitio.escrituras()).toBe(1);
    expect(backups.guardados[0]?.alcance).toContain("plugins:");
  });

  it("rechazada, no se intenta por otra vía", async () => {
    const { ctx, sitio, approvals } = montar();
    const entrada = { plugin: "litespeed-cache", motivo: "Tu página tarda 4,8 segundos en celular." };
    approvals.decidir(huellaAccion("task_1", "velocidad_activar_cache", entrada), "rechazada");

    const r = (await velocidadActivarCache.execute(ctx, entrada)) as { aprobacion_rechazada?: boolean };

    expect(r.aprobacion_rechazada).toBe(true);
    expect(sitio.escrituras()).toBe(0);
  });

  it("si ya hay caché no instala otra encima", async () => {
    const sitio = new SitioEnMemoria({
      plugins: [{ slug: "litespeed-cache", nombre: "LiteSpeed Cache", activo: true }],
    });
    const { ctx, approvals } = montar({ sitio });
    const r = (await velocidadActivarCache.execute(ctx, {
      plugin: "w3-total-cache",
      motivo: "Quiero probar otra caché distinta.",
    })) as { ya_estaba?: boolean };

    expect(r.ya_estaba).toBe(true);
    expect(sitio.escrituras()).toBe(0);
    expect(approvals.solicitudes).toHaveLength(0);
  });

  it("con la conexión en solo lectura, propone en vez de fallar en silencio", async () => {
    const sitio = new SitioEnMemoria({ puedeEscribir: false });
    const { ctx } = montar({ sitio });
    await expect(
      velocidadActivarCache.execute(ctx, {
        plugin: "litespeed-cache",
        motivo: "Tu página tarda 4,8 segundos en celular.",
      }),
    ).rejects.toThrow(/solo lectura/i);
  });
});

describe("comparar antes y después", () => {
  it("sin medición previa no compara: obliga a medir antes", async () => {
    const { ctx } = montar();
    await expect(velocidadComparar.execute(ctx, { ruta: "/", dispositivo: "movil" })).rejects.toThrow(
      /Mide primero/i,
    );
  });

  it("con la medición previa, enseña la diferencia real", async () => {
    const medidor = new MedidorEnMemoria({ enOrden: [medicionLenta(), medicionRapida()] });
    const { ctx } = montar({ medidor });
    await velocidadMedir.execute(ctx, { ruta: "/", dispositivo: "movil" });
    const r = (await velocidadComparar.execute(ctx, { ruta: "/", dispositivo: "movil" })) as {
      mejoro: boolean;
      resumen_legible: string;
      nota: string;
    };
    expect(r.mejoro).toBe(true);
    expect(r.resumen_legible).toContain("4,8 segundos");
    expect(r.resumen_legible).toContain("2,1 segundos");
    expect(r.nota).toContain("tarda unos días en reflejarse");
  });
});
