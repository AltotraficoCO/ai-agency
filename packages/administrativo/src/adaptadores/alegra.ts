/**
 * Alegra, el sistema contable del cliente, detrás del puerto de contabilidad.
 *
 * Traduce en los dos sentidos: de los nombres de Alegra a los del puerto y al
 * revés. Aquí es donde vive todo lo que es propio de Alegra, para que el agente
 * no sepa que existe.
 *
 * **La conversión de moneda se hace aquí, con la tasa del documento.** Alegra
 * guarda en cada factura y en cada pago la moneda y el cambio que aplicó ese
 * día (`currency.exchangeRate`). Convertir con la tasa de hoy daría un número
 * distinto cada vez que se mira la misma factura, y el dueño del negocio no
 * entendería por qué su cartera cambia sola.
 *
 * Autenticación: usuario y token, en Basic. Las credenciales las inyecta el
 * worker; nunca viajan por el esquema de una herramienta.
 *
 * No se ha probado contra la API real: falta el acceso del cliente. Los tipos
 * de respuesta están escritos a partir de lo observado en una cuenta real
 * (facturas abiertas, pagos en pesos y en dólares con su tasa, clientes) y
 * cualquier campo que falte se trata como ausente en vez de romper.
 */
import type {
  BorradorFactura,
  ClienteBreve,
  Cobro,
  CobroRegistrado,
  ContabilidadPort,
  EstadoFactura,
  Factura,
  Importe,
  Moneda,
} from "../ports.js";

export type CredencialesAlegra = {
  /** Correo del usuario de Alegra. */
  readonly usuario: string;
  /** El token de la API, no la contraseña de la cuenta. */
  readonly secreto: string;
  /** Por si algún día cambia el dominio o la versión. */
  readonly baseUrl?: string;
};

export type OpcionesAlegra = {
  readonly fetch?: typeof globalThis.fetch;
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Solo lectura: el cliente no quiere que se emita nada en su nombre. */
  readonly soloLectura?: boolean;
  /** Si se conoce de antemano; si no, se lee de la propia cuenta. */
  readonly monedaBase?: Moneda;
};

const BASE_POR_DEFECTO = "https://api.alegra.com/api/v1";

/** Estados de Alegra → los tres que le importan al agente. */
function estadoDe(valor: unknown): EstadoFactura {
  const s = String(valor ?? "").toLowerCase();
  if (s === "paid" || s === "closed") return "pagada";
  if (s === "void" || s === "cancelled" || s === "canceled") return "anulada";
  if (s === "draft") return "borrador";
  return "abierta";
}

function numero(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === "string") {
    const n = Number.parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

type MonedaDeDocumento = { readonly code?: unknown; readonly exchangeRate?: unknown };

/**
 * Un importe con su equivalente en la moneda del negocio.
 *
 * Cuando el documento está en otra moneda, Alegra trae la tasa que aplicó. Si
 * no la trae, se asume 1 y se deja constancia en la tasa: es preferible un
 * número claramente igual al original que uno inventado.
 */
function importe(valor: unknown, doc: MonedaDeDocumento | undefined, base: Moneda): Importe {
  const cantidad = numero(valor);
  const moneda = typeof doc?.code === "string" && doc.code ? doc.code.toUpperCase() : base.toUpperCase();
  const tasa = moneda === base.toUpperCase() ? 1 : numero(doc?.exchangeRate) || 1;
  return { valor: cantidad, moneda, enMonedaBase: Math.round(cantidad * tasa), tasa };
}

type FacturaAlegra = {
  id?: unknown;
  numberTemplate?: { fullNumber?: unknown; number?: unknown };
  date?: unknown;
  dueDate?: unknown;
  status?: unknown;
  total?: unknown;
  balance?: unknown;
  currency?: MonedaDeDocumento;
  client?: { id?: unknown; name?: unknown };
};

type CobroAlegra = {
  id?: unknown;
  date?: unknown;
  amount?: unknown;
  currency?: MonedaDeDocumento;
  client?: { id?: unknown; name?: unknown };
  bankAccount?: { name?: unknown };
  invoices?: readonly { number?: unknown }[];
};

type ContactoAlegra = { id?: unknown; name?: unknown };

export function crearContabilidadAlegra(
  credenciales: CredencialesAlegra,
  opciones: OpcionesAlegra = {},
): ContabilidadPort {
  const base = credenciales.baseUrl ?? BASE_POR_DEFECTO;
  const f = opciones.fetch ?? globalThis.fetch;
  const autorizacion = `Basic ${Buffer.from(`${credenciales.usuario}:${credenciales.secreto}`).toString("base64")}`;
  let monedaBaseCache: Moneda | null = opciones.monedaBase ?? null;

  function senal(): AbortSignal {
    const propia = AbortSignal.timeout(opciones.timeoutMs ?? 20_000);
    return opciones.abortSignal ? AbortSignal.any([propia, opciones.abortSignal]) : propia;
  }

  async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    const res = await f(`${base}${ruta}`, {
      ...init,
      headers: {
        authorization: autorizacion,
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: senal(),
    });
    if (!res.ok) {
      const cuerpo = (await res.text()).slice(0, 300);
      throw new Error(`Alegra respondió ${res.status} en ${ruta}: ${cuerpo}`);
    }
    return (await res.json()) as T;
  }

  async function monedaBase(): Promise<Moneda> {
    if (monedaBaseCache) return monedaBaseCache;
    try {
      const r = await pedir<{ code?: unknown }>("/currencies/default");
      monedaBaseCache = typeof r.code === "string" && r.code ? r.code.toUpperCase() : "COP";
    } catch {
      // Sin moneda base no se puede ni sumar: se asume la del país del cliente
      // y se sigue, porque fallar aquí dejaría al agente sin poder mirar nada.
      monedaBaseCache = "COP";
    }
    return monedaBaseCache;
  }

  function aFactura(raw: FacturaAlegra, base: Moneda): Factura {
    const total = importe(raw.total, raw.currency, base);
    const saldo = importe(raw.balance ?? raw.total, raw.currency, base);
    const fechaEmision = String(raw.date ?? "");
    return {
      id: String(raw.id ?? ""),
      numero: String(raw.numberTemplate?.fullNumber ?? raw.numberTemplate?.number ?? raw.id ?? ""),
      cliente: {
        id: String(raw.client?.id ?? ""),
        nombre: String(raw.client?.name ?? "Cliente sin nombre"),
      },
      fecha: fechaEmision,
      // Sin vencimiento, se considera vencida el día que se emitió: es lo que
      // hace el propio Alegra con las facturas de contado.
      vence: String(raw.dueDate ?? fechaEmision),
      estado: estadoDe(raw.status),
      total,
      saldo,
    };
  }

  return {
    sistema: "Alegra",
    puedeEscribir: !opciones.soloLectura,
    monedaBase,

    async facturas(input) {
      const base = await monedaBase();
      const parametros = new URLSearchParams({
        limit: String(Math.min(input.limite ?? 30, 30)),
        order_field: "dueDate",
        order_direction: "ASC",
      });
      if (input.estado === "abierta") parametros.set("status", "open");
      if (input.estado === "pagada") parametros.set("status", "closed");
      const crudas = await pedir<readonly FacturaAlegra[]>(`/invoices?${parametros.toString()}`);
      return crudas.map((c) => aFactura(c, base));
    },

    async cobros(input) {
      const base = await monedaBase();
      const parametros = new URLSearchParams({
        limit: String(Math.min(input.limite ?? 30, 30)),
        type: "in",
        order_direction: "DESC",
      });
      const crudos = await pedir<readonly CobroAlegra[]>(`/payments?${parametros.toString()}`);
      return crudos
        .map((c): Cobro => {
          const cliente =
            c.client && c.client.id !== undefined
              ? { id: String(c.client.id), nombre: String(c.client.name ?? "Cliente sin nombre") }
              : undefined;
          return {
            id: String(c.id ?? ""),
            fecha: String(c.date ?? ""),
            importe: importe(c.amount, c.currency, base),
            ...(cliente ? { cliente } : {}),
            ...(c.bankAccount?.name ? { cuenta: String(c.bankAccount.name) } : {}),
            ...(c.invoices ? { facturas: c.invoices.map((i) => String(i.number ?? "")) } : {}),
          };
        })
        .filter((c) => (!input.desde || c.fecha >= input.desde) && (!input.hasta || c.fecha <= input.hasta));
    },

    async buscarClientes(input) {
      const parametros = new URLSearchParams({
        limit: String(Math.min(input.limite ?? 10, 30)),
        type: "client",
      });
      if (input.texto.trim()) parametros.set("query", input.texto.trim());
      const crudos = await pedir<readonly ContactoAlegra[]>(`/contacts?${parametros.toString()}`);
      return crudos.map(
        (c): ClienteBreve => ({ id: String(c.id ?? ""), nombre: String(c.name ?? "Cliente sin nombre") }),
      );
    },

    async crearFactura(borrador: BorradorFactura): Promise<Factura> {
      const base = await monedaBase();
      const cuerpo = {
        client: { id: borrador.clienteId },
        date: new Date().toISOString().slice(0, 10),
        ...(borrador.vence ? { dueDate: borrador.vence } : {}),
        ...(borrador.nota ? { observations: borrador.nota } : {}),
        currency: { code: borrador.moneda.toUpperCase() },
        items: borrador.lineas.map((l) => ({
          name: l.descripcion,
          quantity: l.cantidad,
          price: l.precio,
          ...(l.impuestoPorcentaje
            ? { tax: [{ percentage: l.impuestoPorcentaje }] }
            : {}),
        })),
      };
      const creada = await pedir<FacturaAlegra>("/invoices", {
        method: "POST",
        body: JSON.stringify(cuerpo),
      });
      return aFactura(creada, base);
    },

    async registrarCobro(cobro: CobroRegistrado): Promise<Cobro> {
      const base = await monedaBase();
      const cuerpo = {
        date: cobro.fecha,
        amount: cobro.importe,
        type: "in",
        currency: { code: cobro.moneda.toUpperCase() },
        ...(cobro.cuentaId ? { bankAccount: { id: cobro.cuentaId } } : {}),
        invoices: [{ id: cobro.facturaId, amount: cobro.importe }],
      };
      const creado = await pedir<CobroAlegra>("/payments", {
        method: "POST",
        body: JSON.stringify(cuerpo),
      });
      return {
        id: String(creado.id ?? ""),
        fecha: String(creado.date ?? cobro.fecha),
        importe: importe(creado.amount ?? cobro.importe, creado.currency, base),
        ...(creado.bankAccount?.name ? { cuenta: String(creado.bankAccount.name) } : {}),
      };
    },
  };
}
