/**
 * El informe del negocio, contra el doble del sistema contable.
 *
 * Lo que se verifica aquí son las tres promesas que hacen que un informe sirva:
 * que los números salgan de los documentos y no del modelo, que un dato se
 * compare con algo para ser noticia, y que cuando falta información se DIGA en
 * vez de dar un total que parece completo. Y una cuarta, que es de seguridad:
 * el agente de Reportes no puede escribir en la contabilidad porque no tiene
 * con qué, no porque el prompt se lo pida.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import { adminInformeDelNegocio } from "../src/tools/index.js";
import { reportes, administrativo } from "../src/agent.js";
import { herramientasDe } from "../src/loop.js";
import {
  comparar,
  deudoresDestacados,
  diasDelPeriodo,
  informeDelNegocio,
  periodoAnterior,
} from "../src/informe.js";
import { SCOPES_ADMINISTRATIVO_LECTURA } from "../src/context.js";
import type { LibrosContext } from "../src/ports.js";
import {
  AprobacionesEnMemoria,
  COBROS_DE_EJEMPLO,
  COBROS_PERIODO_ANTERIOR,
  ContabilidadEnMemoria,
  EGRESOS_DE_EJEMPLO,
  FACTURAS_DE_EJEMPLO,
  enPesos,
} from "../src/testing/dobles.js";

const AHORA = new Date("2026-09-12T15:00:00.000Z");

/** Un doble con datos en los dos periodos: sin eso no hay nada que comparar. */
function montar(o: { contabilidad?: ContabilidadEnMemoria } = {}) {
  const contabilidad =
    o.contabilidad ??
    new ContabilidadEnMemoria({
      cobros: [...COBROS_DE_EJEMPLO, ...COBROS_PERIODO_ANTERIOR],
      egresos: EGRESOS_DE_EJEMPLO,
    });
  const libros: LibrosContext = {
    conexionId: "con_1",
    taskId: "task_1",
    contabilidad,
    approvals: new AprobacionesEnMemoria(),
  };
  const ctx = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_ADMINISTRATIVO_LECTURA,
    ports: {},
    now: () => AHORA,
    libros,
  } as unknown as ToolContext;
  return { ctx, contabilidad };
}

type Informe = {
  titular: string;
  informe: string[];
  entro: string;
  salio: string | null;
  saldo_del_periodo: string | null;
  te_deben: string;
  quien_debe_mas: { cliente: string; debe: string; facturas: number; dias_de_atraso: number }[];
  periodo: { desde: string; hasta: string };
  periodo_comparado: { desde: string; hasta: string };
  datos_incompletos?: string[];
};

describe("el periodo con el que se compara", () => {
  it("es el mismo número de días, justo antes", () => {
    const p = { desde: "2026-08-14", hasta: "2026-09-12" };
    expect(diasDelPeriodo(p)).toBe(30);
    // Comparar 15 días contra un mes entero diría que todo bajó a la mitad.
    expect(periodoAnterior(p)).toEqual({ desde: "2026-07-15", hasta: "2026-08-13" });
    expect(diasDelPeriodo(periodoAnterior(p))).toBe(30);
  });

  it("no inventa un porcentaje cuando antes no hubo nada", () => {
    expect(comparar(500, 0).porcentaje).toBeNull();
    expect(comparar(150, 100).porcentaje).toBe(50);
  });
});

describe("quién debe más", () => {
  it("agrupa por cliente y no por factura", () => {
    // Al dueño no le sirve «tres facturas de 6, 5 y 4»: le sirve quién le debe.
    const lista = deudoresDestacados(FACTURAS_DE_EJEMPLO, AHORA, 3);
    expect(lista).toHaveLength(3);
    expect(lista[0]!.cliente).toBe("Constructora del Valle");
    expect(lista[0]!.total).toBe(18_400_000);
    expect(lista[0]!.atrasoMaximo).toBeGreaterThan(100);
    // La factura ya pagada de Distribuciones Pérez no cuenta.
    expect(lista.find((d) => d.cliente === "Distribuciones Pérez")?.facturas).toBe(1);
  });

  it("deja fuera al que menos debe cuando solo caben tres", () => {
    const lista = deudoresDestacados(FACTURAS_DE_EJEMPLO, AHORA, 3);
    expect(lista.map((d) => d.cliente)).not.toContain("Panadería La Espiga");
  });
});

describe("el informe", () => {
  it("cuenta lo que entró comparado con el periodo anterior", async () => {
    const { ctx } = montar();
    const r = (await adminInformeDelNegocio.execute(ctx, { dias: 30 })) as unknown as Informe;

    expect(r.periodo).toEqual({ desde: "2026-08-14", hasta: "2026-09-12" });
    expect(r.periodo_comparado).toEqual({ desde: "2026-07-15", hasta: "2026-08-13" });
    // 4.252.000 en pesos + 200 dólares convertidos con la tasa del documento.
    expect(r.entro).toContain("4.898.088");
    expect(r.informe.join(" ")).toContain("más que en el periodo anterior");
  });

  it("dice lo que salió y con cuánto se quedó el negocio", async () => {
    const { ctx } = montar();
    const r = (await adminInformeDelNegocio.execute(ctx, { dias: 30 })) as unknown as Informe;
    expect(r.salio).toContain("3.000.000");
    expect(r.saldo_del_periodo).toContain("1.898.088");
    expect(r.informe.join(" ")).toContain("a favor");
  });

  it("empieza por lo que el dueño lee si no lee nada más", async () => {
    const { ctx } = montar();
    const r = (await adminInformeDelNegocio.execute(ctx, { dias: 30 })) as unknown as Informe;
    expect(r.titular).toContain("Te deben");
    expect(r.titular).toContain("vencidos");
    expect(r.quien_debe_mas[0]!.cliente).toBe("Constructora del Valle");
  });

  it("admite cuando no pudo leerlo todo, en vez de dar un total a medias", async () => {
    const contabilidad = new ContabilidadEnMemoria({
      cobros: [...COBROS_DE_EJEMPLO, ...COBROS_PERIODO_ANTERIOR],
      egresos: EGRESOS_DE_EJEMPLO,
      lecturaCompleta: false,
    });
    const { ctx } = montar({ contabilidad });
    const r = (await adminInformeDelNegocio.execute(ctx, { dias: 30 })) as unknown as Informe;

    expect(r.datos_incompletos).toContain("facturas");
    expect(r.informe.join(" ")).toContain("puede ser más");
  });

  it("cuando el sistema no deja ver lo que salió, lo dice y no insinúa un saldo", async () => {
    // Un usuario de Alegra sin permiso para ver pagos salientes: pasa de verdad.
    const contabilidad = new ContabilidadEnMemoria({
      cobros: [...COBROS_DE_EJEMPLO, ...COBROS_PERIODO_ANTERIOR],
    });
    const { ctx } = montar({ contabilidad });
    const r = (await adminInformeDelNegocio.execute(ctx, { dias: 30 })) as unknown as Informe;

    expect(r.salio).toBeNull();
    expect(r.saldo_del_periodo).toBeNull();
    expect(r.informe.join(" ")).toContain("no me deja ver lo que salió");
  });

  it("no habla como un contador", async () => {
    const { ctx } = montar();
    const r = (await adminInformeDelNegocio.execute(ctx, { dias: 30 })) as unknown as Informe;
    const texto = [r.titular, ...r.informe].join(" ").toLowerCase();
    for (const jerga of ["cartera", "cxc", "conciliaci", "causaci", "flujo de caja", "partida"]) {
      expect(texto).not.toContain(jerga);
    }
  });

  it("con las cuentas al día no se inventa una deuda", () => {
    const informe = informeDelNegocio({
      moneda: "COP",
      periodo: { desde: "2026-08-14", hasta: "2026-09-12" },
      facturas: [],
      cobros: [{ id: "c", fecha: "2026-09-01", importe: enPesos(900_000) }],
      cobrosAnteriores: [],
      hoy: AHORA,
    });
    expect(informe.lineas.join(" ")).toContain("No te debe nadie");
    expect(informe.caja.porCobrar).toBe(0);
  });
});

describe("Reportes solo mira", () => {
  it("no tiene ninguna herramienta que escriba en la contabilidad", () => {
    const slugs = herramientasDe(reportes).map((h) => h.slug);
    expect(slugs).toContain("admin_informe_del_negocio");
    // Ni emitir, ni registrar, ni aprobar: lo que no se tiene no se puede usar,
    // por mucho que se lo pidan al modelo.
    expect(slugs).not.toContain("admin_emitir_factura");
    expect(slugs).not.toContain("admin_registrar_pago");
    expect(slugs).not.toContain("pedir_aprobacion");
    // El Administrativo sí las tiene: son dos puestos distintos.
    expect(herramientasDe(administrativo).map((h) => h.slug)).toContain("admin_emitir_factura");
  });

  it("preparar el informe no escribe ni un documento", async () => {
    const { ctx, contabilidad } = montar();
    await adminInformeDelNegocio.execute(ctx, { dias: 30 });
    expect(contabilidad.escrituras()).toBe(0);
  });
});
