/**
 * Dobles del sistema contable y de los puertos.
 *
 * Existen para poder construir y probar el agente ENTERO sin las credenciales
 * de Alegra del cliente. Cuando lleguen, el adaptador real rellena la misma
 * interfaz y estos tests siguen valiendo.
 *
 * Los datos de ejemplo imitan la forma de una cuenta real: facturas muy
 * vencidas y recientes, importes grandes en pesos y cobros pequeños en dólares
 * con su tasa. Los nombres son inventados.
 */
import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
  BackupPort,
  BorradorFactura,
  ClienteBreve,
  Cobro,
  CobroRegistrado,
  ContabilidadPort,
  EstadoFactura,
  Factura,
  Importe,
  MensajeriaPort,
  Moneda,
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

export class MensajeriaEnMemoria implements MensajeriaPort {
  readonly canal = "WhatsApp";
  readonly enviados: { clienteId: string; texto: string }[] = [];

  async enviar(input: { clienteId: string; texto: string }) {
    this.enviados.push(input);
    return { enviado: true, id: `msg_${this.enviados.length}` };
  }
}

/** Un importe en la moneda del negocio: tasa 1 y mismo valor. */
export const enPesos = (valor: number): Importe => ({
  valor,
  moneda: "COP",
  enMonedaBase: valor,
  tasa: 1,
});

/** Un importe en dólares, convertido con la tasa que guardó el documento. */
export const enDolares = (valor: number, tasa = 3_230.44): Importe => ({
  valor,
  moneda: "USD",
  enMonedaBase: Math.round(valor * tasa),
  tasa,
});

export const CLIENTES_DE_EJEMPLO: readonly ClienteBreve[] = [
  { id: "cli_1", nombre: "Distribuciones Pérez" },
  { id: "cli_2", nombre: "Constructora del Valle" },
  { id: "cli_3", nombre: "Mission Kapital LLC" },
  { id: "cli_4", nombre: "Panadería La Espiga" },
];

/**
 * Facturas con la forma de una cartera real: una muy vencida y grande, dos de
 * hace semanas, una que vence en unos días y una ya pagada.
 *
 * Las fechas son fijas a propósito: los tests fijan «hoy» en 2026-09-12.
 */
export const FACTURAS_DE_EJEMPLO: readonly Factura[] = [
  {
    id: "f_1",
    numero: "FV-1001",
    cliente: CLIENTES_DE_EJEMPLO[1]!,
    fecha: "2026-04-10",
    vence: "2026-05-10",
    estado: "abierta",
    total: enPesos(18_400_000),
    saldo: enPesos(18_400_000),
  },
  {
    id: "f_2",
    numero: "FV-1042",
    cliente: CLIENTES_DE_EJEMPLO[0]!,
    fecha: "2026-07-20",
    vence: "2026-08-19",
    estado: "abierta",
    total: enPesos(4_252_000),
    saldo: enPesos(4_252_000),
  },
  {
    id: "f_3",
    numero: "FV-1080",
    cliente: CLIENTES_DE_EJEMPLO[2]!,
    fecha: "2026-08-15",
    vence: "2026-09-04",
    estado: "abierta",
    total: enDolares(955),
    saldo: enDolares(955),
  },
  {
    id: "f_4",
    numero: "FV-1095",
    cliente: CLIENTES_DE_EJEMPLO[3]!,
    fecha: "2026-09-01",
    vence: "2026-09-16",
    estado: "abierta",
    total: enPesos(620_200),
    saldo: enPesos(620_200),
  },
  {
    id: "f_5",
    numero: "FV-0999",
    cliente: CLIENTES_DE_EJEMPLO[0]!,
    fecha: "2026-06-01",
    vence: "2026-06-30",
    estado: "pagada",
    total: enPesos(2_000_000),
    saldo: enPesos(0),
  },
];

export const COBROS_DE_EJEMPLO: readonly Cobro[] = [
  {
    id: "p_1",
    fecha: "2026-09-11",
    importe: enPesos(4_252_000),
    cliente: CLIENTES_DE_EJEMPLO[0]!,
    cuenta: "Corriente Bancolombia",
  },
  {
    id: "p_2",
    fecha: "2026-09-09",
    importe: enDolares(200),
    cliente: CLIENTES_DE_EJEMPLO[2]!,
    cuenta: "PayPal",
  },
];

/**
 * Cobros del periodo anterior, para poder comparar.
 *
 * Deliberadamente MENORES que los de `COBROS_DE_EJEMPLO`: así el informe tiene
 * que decir que este periodo entró más, que es la frase que de verdad se prueba.
 */
export const COBROS_PERIODO_ANTERIOR: readonly Cobro[] = [
  {
    id: "p_ant_1",
    // Julio: con «hoy» en 2026-09-12 y 30 días, el periodo actual empieza el 14
    // de agosto, así que esto cae de lleno en el periodo con el que se compara.
    fecha: "2026-07-20",
    importe: enPesos(1_500_000),
    cliente: CLIENTES_DE_EJEMPLO[1]!,
    cuenta: "Corriente Bancolombia",
  },
];

/** Dinero que salió: proveedores y nómina. Uno en cada periodo, para comparar. */
export const EGRESOS_DE_EJEMPLO: readonly Cobro[] = [
  { id: "e_1", fecha: "2026-09-05", importe: enPesos(3_000_000), cuenta: "Corriente Bancolombia" },
  { id: "e_2", fecha: "2026-07-18", importe: enPesos(2_800_000), cuenta: "Corriente Bancolombia" },
];

export type OpcionesDobleContabilidad = {
  readonly puedeEscribir?: boolean;
  readonly monedaBase?: Moneda;
  readonly facturas?: readonly Factura[];
  readonly cobros?: readonly Cobro[];
  readonly clientes?: readonly ClienteBreve[];
  /** Pagos que salieron. Sin esto, el doble no sabe de egresos, como Alegra sin permiso. */
  readonly egresos?: readonly Cobro[];
  /**
   * false: el doble simula un sistema con más documentos de los que se pudieron
   * leer, que es lo que pasa en una cuenta grande. Sirve para probar que el
   * informe lo admite en vez de dar totales a medias.
   */
  readonly lecturaCompleta?: boolean;
};

export class ContabilidadEnMemoria implements ContabilidadPort {
  readonly sistema = "Alegra";
  readonly puedeEscribir: boolean;
  readonly llamadas: { metodo: string; entrada: unknown }[] = [];
  #moneda: Moneda;
  #facturas: Factura[];
  #cobros: Cobro[];
  #clientes: ClienteBreve[];
  #egresos: Cobro[];
  #completo: boolean;
  #n = 0;

  constructor(o: OpcionesDobleContabilidad = {}) {
    this.puedeEscribir = o.puedeEscribir ?? true;
    this.#moneda = o.monedaBase ?? "COP";
    this.#facturas = [...(o.facturas ?? FACTURAS_DE_EJEMPLO)];
    this.#cobros = [...(o.cobros ?? COBROS_DE_EJEMPLO)];
    this.#clientes = [...(o.clientes ?? CLIENTES_DE_EJEMPLO)];
    this.#egresos = [...(o.egresos ?? [])];
    this.#completo = o.lecturaCompleta ?? true;
    if (o.egresos) {
      this.egresos = async (input) => {
        this.llamadas.push({ metodo: "egresos", entrada: input });
        return { items: this.#enPeriodo(this.#egresos, input), completo: this.#completo };
      };
    }
  }

  async monedaBase(): Promise<Moneda> {
    return this.#moneda;
  }

  async facturas(input: { estado?: EstadoFactura; limite?: number }): Promise<readonly Factura[]> {
    this.llamadas.push({ metodo: "facturas", entrada: input });
    const lista = input.estado ? this.#facturas.filter((f) => f.estado === input.estado) : this.#facturas;
    return input.limite ? lista.slice(0, input.limite) : lista;
  }

  async cobros(input: { desde?: string; hasta?: string; limite?: number }): Promise<readonly Cobro[]> {
    this.llamadas.push({ metodo: "cobros", entrada: input });
    const lista = this.#cobros.filter(
      (c) => (!input.desde || c.fecha >= input.desde) && (!input.hasta || c.fecha <= input.hasta),
    );
    return input.limite ? lista.slice(0, input.limite) : lista;
  }

  async facturasTodas(input: { estado?: EstadoFactura; tope?: number }) {
    this.llamadas.push({ metodo: "facturasTodas", entrada: input });
    const lista = input.estado ? this.#facturas.filter((f) => f.estado === input.estado) : this.#facturas;
    return { items: lista, completo: this.#completo };
  }

  async cobrosTodos(input: { desde?: string; hasta?: string; tope?: number }) {
    this.llamadas.push({ metodo: "cobrosTodos", entrada: input });
    return { items: this.#enPeriodo(this.#cobros, input), completo: this.#completo };
  }

  /**
   * Ver lo que SALIÓ es opcional, y por eso es un campo y no un método.
   *
   * Un usuario de Alegra sin ese permiso no tiene esta capacidad en absoluto, y
   * el informe tiene que notar la diferencia entre «salieron 0 pesos» y «no
   * puedo ver lo que salió». Si el doble siempre respondiera, esa diferencia
   * nunca se probaría.
   */
  readonly egresos?: (input: {
    desde?: string;
    hasta?: string;
    tope?: number;
  }) => Promise<{ items: readonly Cobro[]; completo: boolean }>;

  #enPeriodo(lista: readonly Cobro[], input: { desde?: string; hasta?: string }): readonly Cobro[] {
    return lista.filter(
      (c) => (!input.desde || c.fecha >= input.desde) && (!input.hasta || c.fecha <= input.hasta),
    );
  }

  async buscarClientes(input: { texto: string; limite?: number }): Promise<readonly ClienteBreve[]> {
    this.llamadas.push({ metodo: "buscarClientes", entrada: input });
    const texto = input.texto.trim().toLowerCase();
    const lista = texto
      ? this.#clientes.filter((c) => c.nombre.toLowerCase().includes(texto))
      : this.#clientes;
    return input.limite === 0 ? lista : lista.slice(0, input.limite ?? 30);
  }

  async crearFactura(borrador: BorradorFactura): Promise<Factura> {
    this.llamadas.push({ metodo: "crearFactura", entrada: borrador });
    const cliente = this.#clientes.find((c) => c.id === borrador.clienteId);
    if (!cliente) throw new Error("cliente inexistente en el doble");
    const total = borrador.lineas.reduce(
      (s, l) => s + l.cantidad * l.precio * (1 + (l.impuestoPorcentaje ?? 0) / 100),
      0,
    );
    const importe: Importe =
      borrador.moneda.toUpperCase() === this.#moneda.toUpperCase()
        ? { valor: total, moneda: this.#moneda, enMonedaBase: total, tasa: 1 }
        : enDolares(total);
    const factura: Factura = {
      id: `f_nueva_${++this.#n}`,
      numero: `FV-2${String(this.#n).padStart(3, "0")}`,
      cliente,
      fecha: "2026-09-12",
      vence: borrador.vence ?? "2026-10-12",
      estado: "abierta",
      total: importe,
      saldo: importe,
    };
    this.#facturas.push(factura);
    return factura;
  }

  async registrarCobro(cobro: CobroRegistrado): Promise<Cobro> {
    this.llamadas.push({ metodo: "registrarCobro", entrada: cobro });
    const i = this.#facturas.findIndex((f) => f.id === cobro.facturaId);
    const factura = this.#facturas[i];
    if (i < 0 || !factura) throw new Error("factura inexistente en el doble");
    const queda = factura.saldo.valor - cobro.importe;
    this.#facturas[i] = {
      ...factura,
      estado: queda <= 0 ? "pagada" : "abierta",
      saldo: {
        ...factura.saldo,
        valor: Math.max(queda, 0),
        enMonedaBase: Math.max(Math.round(queda * factura.saldo.tasa), 0),
      },
    };
    const registrado: Cobro = {
      id: `p_nuevo_${this.#n}`,
      fecha: cobro.fecha,
      importe:
        cobro.moneda.toUpperCase() === this.#moneda.toUpperCase()
          ? enPesos(cobro.importe)
          : enDolares(cobro.importe),
      cliente: factura.cliente,
      ...(cobro.cuentaId ? { cuenta: cobro.cuentaId } : {}),
      facturas: [factura.numero],
    };
    this.#cobros = [registrado, ...this.#cobros];
    return registrado;
  }

  /** Para comprobar en los tests que NO se emitió nada sin aprobación. */
  escrituras(): number {
    return this.llamadas.filter((l) => l.metodo === "crearFactura" || l.metodo === "registrarCobro").length;
  }
}
