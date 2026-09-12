/**
 * Dobles de las plataformas y de los puertos.
 *
 * Existen para poder construir y probar el agente ENTERO sin credenciales de
 * Google ni de Meta, que tardan semanas en aprobarse. Cuando lleguen, el
 * adaptador real rellena la misma interfaz y estos tests siguen valiendo.
 */
import type {
  AdsPort,
  AnalyticsPort,
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
  BackupPort,
  Campana,
  CuentaPublicitaria,
  Periodo,
  Plataforma,
  ResumenWeb,
} from "../ports.js";

export class BackupsEnMemoria implements BackupPort {
  readonly guardados: { id: string; alcance: string; snapshot: unknown; creadoEn: string }[] = [];
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

  async read(input: { backupId: string }) {
    return this.guardados.find((b) => b.id === input.backupId) ?? null;
  }
}

export class AprobacionesEnMemoria implements ApprovalPort {
  readonly solicitudes: { id: string; huella: string; toolSlug: string; resumen: string; motivo: string }[] = [];
  readonly decisiones = new Map<string, ApprovalDecision>();
  /** Cuando es true, una persona aprueba todo al instante (para probar el camino feliz). */
  apruebaTodo = false;
  #n = 0;

  decidir(huella: string, decision: ApprovalDecision): void {
    this.decisiones.set(huella, decision);
  }

  async check(input: { huella: string }): Promise<ApprovalDecision | null> {
    if (this.apruebaTodo) return "aprobada";
    return this.decisiones.get(input.huella) ?? null;
  }

  async request(input: {
    huella: string;
    toolSlug: string;
    resumen: string;
    motivo: string;
  }): Promise<ApprovalRequest> {
    const id = `ap_${++this.#n}`;
    this.solicitudes.push({
      id,
      huella: input.huella,
      toolSlug: input.toolSlug,
      resumen: input.resumen,
      motivo: input.motivo,
    });
    return { id, decision: this.decisiones.get(input.huella) ?? null };
  }
}

export type OpcionesDobleAds = {
  readonly plataforma?: Plataforma;
  readonly puedeEscribir?: boolean;
  readonly cuenta?: Partial<CuentaPublicitaria>;
  readonly campanas?: readonly Campana[];
};

/** Campañas de ejemplo con la forma de un negocio real: una buena, una cara y una que no trae nada. */
export const CAMPANAS_DE_EJEMPLO: readonly Campana[] = [
  {
    id: "c_buena",
    nombre: "Asesoría legal - búsqueda",
    estado: "activa",
    presupuestoDiario: 30_000,
    metricas: { gasto: 210_000, impresiones: 12_000, clics: 320, conversiones: 14 },
  },
  {
    id: "c_cara",
    nombre: "Marca - display",
    estado: "activa",
    presupuestoDiario: 40_000,
    metricas: { gasto: 280_000, impresiones: 90_000, clics: 210, conversiones: 2 },
  },
  {
    id: "c_seca",
    nombre: "Promo septiembre",
    estado: "activa",
    presupuestoDiario: 20_000,
    metricas: { gasto: 140_000, impresiones: 30_000, clics: 95, conversiones: 0 },
  },
  {
    id: "c_dormida",
    nombre: "Campaña vieja",
    estado: "pausada",
    presupuestoDiario: 10_000,
    metricas: { gasto: 0, impresiones: 0, clics: 0, conversiones: 0 },
  },
];

export class AdsEnMemoria implements AdsPort {
  readonly plataforma: Plataforma;
  readonly puedeEscribir: boolean;
  readonly llamadas: { metodo: string; entrada: unknown }[] = [];
  #cuenta: CuentaPublicitaria;
  #campanas: Campana[];

  constructor(o: OpcionesDobleAds = {}) {
    this.plataforma = o.plataforma ?? "google_ads";
    this.puedeEscribir = o.puedeEscribir ?? true;
    this.#cuenta = {
      id: "acc_1",
      plataforma: this.plataforma,
      nombre: "Cuenta principal",
      moneda: "COP",
      ...o.cuenta,
    };
    this.#campanas = [...(o.campanas ?? CAMPANAS_DE_EJEMPLO)];
  }

  async cuentas(): Promise<readonly CuentaPublicitaria[]> {
    this.llamadas.push({ metodo: "cuentas", entrada: null });
    return [this.#cuenta];
  }

  async campanas(input: { cuentaId: string; periodo: Periodo }): Promise<readonly Campana[]> {
    this.llamadas.push({ metodo: "campanas", entrada: input });
    return this.#campanas;
  }

  async cambiarPresupuesto(input: { cuentaId: string; campanaId: string; diario: number }) {
    this.llamadas.push({ metodo: "cambiarPresupuesto", entrada: input });
    const i = this.#campanas.findIndex((c) => c.id === input.campanaId);
    const actual = this.#campanas[i];
    if (i < 0 || !actual) throw new Error("campaña inexistente en el doble");
    const anterior = actual.presupuestoDiario ?? 0;
    this.#campanas[i] = { ...actual, presupuestoDiario: input.diario };
    return { campanaId: input.campanaId, anterior, nuevo: input.diario };
  }

  async cambiarEstado(input: { cuentaId: string; campanaId: string; estado: "activa" | "pausada" }) {
    this.llamadas.push({ metodo: "cambiarEstado", entrada: input });
    const i = this.#campanas.findIndex((c) => c.id === input.campanaId);
    const actual = this.#campanas[i];
    if (i < 0 || !actual) throw new Error("campaña inexistente en el doble");
    const anterior = actual.estado;
    this.#campanas[i] = { ...actual, estado: input.estado };
    return { campanaId: input.campanaId, anterior, nuevo: input.estado };
  }

  /** Para comprobar en los tests que NO se tocó nada sin aprobación. */
  escrituras(): number {
    return this.llamadas.filter((l) => l.metodo.startsWith("cambiar")).length;
  }
}

export class AnalyticsEnMemoria implements AnalyticsPort {
  constructor(private readonly datos?: Partial<ResumenWeb>) {}

  async propiedades() {
    return [{ id: "prop_1", nombre: "Sitio del negocio" }];
  }

  async resumen(input: { propiedadId: string; periodo: Periodo }): Promise<ResumenWeb> {
    return {
      propiedadId: input.propiedadId,
      periodo: input.periodo,
      sesiones: 1_240,
      usuarios: 980,
      conversiones: 31,
      canales: [
        { nombre: "Búsqueda de pago", sesiones: 520, conversiones: 16 },
        { nombre: "Búsqueda orgánica", sesiones: 430, conversiones: 11 },
        { nombre: "Directo", sesiones: 290, conversiones: 4 },
      ],
      ...this.datos,
    };
  }
}
