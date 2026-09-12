/**
 * Puertos del agente Administrativo.
 *
 * Aquí no hay ni una llamada HTTP: son las interfaces que el worker rellena con
 * el adaptador real (hoy Alegra) y que los tests rellenan con dobles. Esa
 * frontera es lo que permite construir y probar el agente ENTERO hoy, sin
 * credenciales del sistema contable del cliente.
 *
 * Dos decisiones que no son de estilo:
 *
 *  · **El dinero viaja con su moneda y con su equivalente en la moneda del
 *    negocio.** La cuenta real que inspiramos tiene cobros en pesos y en
 *    dólares, con la tasa del día del documento. Sumar «42 millones» mezclando
 *    ambas sin convertir sería mentirle al dueño; convertir en el modelo sería
 *    peor, porque cada vez daría otro número. Convierte el adaptador, con la
 *    tasa que el propio sistema contable guardó en el documento.
 *
 *  · **Nada de nombres de Alegra.** El puerto habla de facturas, cobros y
 *    clientes. Si mañana el cliente lleva su contabilidad en otro sitio, se
 *    escribe otro adaptador y el agente no se entera.
 */

/** ISO 4217: COP, USD, MXN… */
export type Moneda = string;

/**
 * Un importe tal y como lo guardó el sistema contable.
 *
 * `enMonedaBase` es el mismo importe convertido a la moneda del negocio con la
 * tasa que el documento llevaba. Si el documento ya está en la moneda base,
 * ambos coinciden y `tasa` es 1.
 */
export type Importe = {
  readonly valor: number;
  readonly moneda: Moneda;
  readonly enMonedaBase: number;
  readonly tasa: number;
};

export type EstadoFactura = "abierta" | "pagada" | "anulada" | "borrador";

export type ClienteBreve = {
  readonly id: string;
  readonly nombre: string;
};

/**
 * Una factura de venta.
 *
 * No lleva identificación fiscal, ni dirección, ni correo: el agente no los
 * necesita para su trabajo y lo que no viaja no se puede filtrar en un resumen.
 * Quien tenga que emitir un documento legal lo hace en el sistema contable.
 */
export type Factura = {
  readonly id: string;
  /** El número que ve el cliente: «FV-1042». */
  readonly numero: string;
  readonly cliente: ClienteBreve;
  /** YYYY-MM-DD. */
  readonly fecha: string;
  /** YYYY-MM-DD. Sin vencimiento se considera vencida el mismo día. */
  readonly vence: string;
  readonly estado: EstadoFactura;
  readonly total: Importe;
  /** Lo que queda por cobrar. Cero en una factura ya pagada. */
  readonly saldo: Importe;
};

export type Cobro = {
  readonly id: string;
  readonly fecha: string;
  readonly importe: Importe;
  readonly cliente?: ClienteBreve;
  /** Cómo entró el dinero: «Bancolombia», «PayPal»… */
  readonly cuenta?: string;
  /** Facturas a las que se aplicó, si el sistema lo dice. */
  readonly facturas?: readonly string[];
};

/** Una línea de lo que se factura. */
export type LineaFactura = {
  readonly descripcion: string;
  readonly cantidad: number;
  /** Precio unitario, en la moneda de la factura. */
  readonly precio: number;
  /** Porcentaje de impuesto, 0 si no lleva. */
  readonly impuestoPorcentaje?: number;
};

export type BorradorFactura = {
  readonly clienteId: string;
  readonly moneda: Moneda;
  readonly lineas: readonly LineaFactura[];
  /** YYYY-MM-DD. Si falta, lo decide el sistema contable. */
  readonly vence?: string;
  readonly nota?: string;
};

export type CobroRegistrado = {
  readonly facturaId: string;
  readonly importe: number;
  readonly moneda: Moneda;
  readonly fecha: string;
  /** Cuenta bancaria del sistema contable donde entró el dinero. */
  readonly cuentaId?: string;
};

/**
 * El sistema contable del negocio.
 *
 * Escribir es opcional: una conexión puede quedarse en solo lectura, porque el
 * cliente no quiere que nadie emita documentos en su nombre o porque sus
 * credenciales no lo permiten. El agente tiene que saber decirlo en vez de
 * fallar con un error técnico.
 */
/**
 * Una lectura que puede no haber traído todo lo que hay.
 *
 * Los sistemas contables paginan: Alegra devuelve 30 documentos por llamada. Un
 * informe con totales incompletos es PEOR que no tener informe, porque el dueño
 * toma decisiones con un número que parece completo y no lo es. Por eso una
 * lectura dice siempre si llegó hasta el final.
 */
export type Lectura<T> = {
  readonly items: readonly T[];
  /** false: el sistema tiene más documentos de los que se pudieron leer. */
  readonly completo: boolean;
};

export interface ContabilidadPort {
  /** Nombre del sistema, para poder decírselo al cliente: «Alegra». */
  readonly sistema: string;
  /** false cuando la conexión solo permite leer. */
  readonly puedeEscribir: boolean;
  /** Moneda en la que el negocio lleva sus cuentas. */
  monedaBase(): Promise<Moneda>;
  /** Facturas de venta. `estado` filtra; sin filtro, todas las que el sistema devuelva. */
  facturas(input: { estado?: EstadoFactura; limite?: number }): Promise<readonly Factura[]>;
  /** Cobros recibidos, del más reciente al más antiguo. */
  cobros(input: { desde?: string; hasta?: string; limite?: number }): Promise<readonly Cobro[]>;
  buscarClientes(input: { texto: string; limite?: number }): Promise<readonly ClienteBreve[]>;
  crearFactura(borrador: BorradorFactura): Promise<Factura>;
  registrarCobro(cobro: CobroRegistrado): Promise<Cobro>;

  // -------------------------------------------------------------------------
  // Lectura completa, para el informe del negocio
  // -------------------------------------------------------------------------
  //
  // Son opcionales a propósito: una implementación que no las traiga sigue
  // valiendo, y quien las necesite cae a `facturas()` / `cobros()` y avisa de
  // que pudo quedarse corto. Así añadirlas no rompió nada de lo que ya existía.

  /** Todas las facturas que haya, paginando. */
  facturasTodas?(input: { estado?: EstadoFactura; tope?: number }): Promise<Lectura<Factura>>;
  /** Todos los cobros del periodo, paginando. */
  cobrosTodos?(input: { desde?: string; hasta?: string; tope?: number }): Promise<Lectura<Cobro>>;
  /**
   * Dinero que SALIÓ en el periodo: pagos a proveedores, nómina, gastos.
   *
   * Opcional porque no todos los sistemas lo exponen igual. Sin esto el informe
   * dice lo que entró y admite que no pudo leer lo que salió, en vez de dar por
   * bueno un saldo que sería mentira.
   */
  egresos?(input: { desde?: string; hasta?: string; tope?: number }): Promise<Lectura<Cobro>>;
}

/**
 * Por dónde sale un recordatorio de cobro.
 *
 * Se declara aquí y NO se implementa: quien habla con los clientes es el agente
 * de Comunicaciones, que ya tiene WhatsApp conectado, la bandeja y el historial.
 * Este agente redacta y propone; el envío es de otro departamento. Dejar el
 * puerto escrito es lo que permitirá enchufarlo sin rehacer nada.
 */
export interface MensajeriaPort {
  /** Canal por el que saldría: «WhatsApp». */
  readonly canal: string;
  enviar(input: { clienteId: string; texto: string }): Promise<{ readonly enviado: boolean; readonly id?: string }>;
}

// ---------------------------------------------------------------------------
// Aprobación humana y backups (misma forma que en el Webmaster y en Marketing)
// ---------------------------------------------------------------------------

export type ApprovalDecision = "aprobada" | "rechazada";

export type ApprovalRequest = {
  readonly id: string;
  readonly decision: ApprovalDecision | null;
};

export interface ApprovalPort {
  check(input: { workspaceId: string; taskId: string; huella: string }): Promise<ApprovalDecision | null>;
  request(input: {
    workspaceId: string;
    taskId: string;
    siteId: string;
    huella: string;
    toolSlug: string;
    motivo: string;
    resumen: string;
    entrada: unknown;
  }): Promise<ApprovalRequest>;
}

export interface BackupPort {
  create(input: {
    workspaceId: string;
    siteId: string;
    taskId: string;
    alcance: string;
    snapshot: unknown;
  }): Promise<string>;
  read(input: { workspaceId: string; backupId: string }): Promise<{
    readonly id: string;
    readonly alcance: string;
    readonly snapshot: unknown;
    readonly creadoEn: string;
  } | null>;
}

// ---------------------------------------------------------------------------
// Contexto de trabajo
// ---------------------------------------------------------------------------

/**
 * Lo que el runtime inyecta en cada ejecución. NADA de esto puede venir del
 * modelo: si el modelo pudiera elegir la conexión contable, una inyección de
 * prompt sería facturar en nombre de otro cliente.
 */
export type LibrosContext = {
  /** Id de la conexión del encargo: la que se guarda en `agent_tasks`. */
  readonly conexionId: string;
  readonly taskId: string;
  /** Sin conexión contable el agente no puede trabajar, y tiene que decirlo. */
  readonly contabilidad?: ContabilidadPort;
  /** Hoy nunca viene. Existe para que enchufarlo sea rellenar, no rehacer. */
  readonly mensajeria?: MensajeriaPort;
  readonly approvals: ApprovalPort;
  readonly backups?: BackupPort;
  /**
   * Primer contacto: el agente mira y propone, no emite nada. El primer día con
   * la contabilidad de un cliente no puede ser también el primer día en que le
   * emitimos una factura.
   */
  readonly primerContacto?: boolean;
};

export function requireContabilidad(libros: LibrosContext, toolSlug: string): ContabilidadPort {
  if (!libros.contabilidad) {
    throw new Error(
      `"${toolSlug}" necesita el sistema de facturación conectado y este espacio no lo tiene. ` +
        `Dile al cliente que lo conecte en Ajustes → Canales.`,
    );
  }
  return libros.contabilidad;
}

export function exigirEscritura(contabilidad: ContabilidadPort, toolSlug: string): void {
  if (!contabilidad.puedeEscribir) {
    throw new Error(
      `La conexión con ${contabilidad.sistema} es de solo lectura: con "${toolSlug}" puedes proponerlo en el RESUMEN, pero no emitirlo.`,
    );
  }
}
