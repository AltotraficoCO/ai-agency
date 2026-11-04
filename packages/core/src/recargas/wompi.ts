/**
 * Wompi: firma del pago y verificación de sus eventos.
 *
 * Módulo PURO, sin red ni base de datos. Los secretos entran por parámetro y
 * nunca salen del servidor.
 *
 * Referencia: docs.wompi.co, «Widget & Checkout Web» y «Eventos».
 */
import { createHash, timingSafeEqual } from "node:crypto";

const CHECKOUT = "https://checkout.wompi.co/p/";

export type LlavesWompi = {
  readonly publica: string;
  readonly privada: string;
  readonly integridad: string;
  readonly eventos: string;
};

export type AmbienteWompi = "pruebas" | "produccion";

const PREFIJOS: Readonly<Record<keyof LlavesWompi, readonly [string, string, string]>> = {
  publica: ["pub_test_", "pub_prod_", "llave pública"],
  privada: ["prv_test_", "prv_prod_", "llave privada"],
  integridad: ["test_integrity_", "prod_integrity_", "secreto de integridad"],
  eventos: ["test_events_", "prod_events_", "secreto de eventos"],
};

/**
 * Comprueba forma y ambiente. Mezclar llaves de pruebas y de producción no da un
 * error claro: da pagos que nadie confirma, días después.
 */
export function validarLlaves(llaves: LlavesWompi): { ok: true; ambiente: AmbienteWompi } | { ok: false; motivo: string } {
  const ambientes = new Set<AmbienteWompi>();
  for (const clave of Object.keys(PREFIJOS) as (keyof LlavesWompi)[]) {
    const [pruebas, produccion, nombre] = PREFIJOS[clave];
    const valor = llaves[clave];
    if (valor.startsWith(pruebas)) ambientes.add("pruebas");
    else if (valor.startsWith(produccion)) ambientes.add("produccion");
    else return { ok: false, motivo: `La ${nombre} debe empezar por ${pruebas} o ${produccion}.` };
  }
  if (ambientes.size > 1) {
    return { ok: false, motivo: "Hay llaves de pruebas mezcladas con llaves de producción." };
  }
  return { ok: true, ambiente: [...ambientes][0]! };
}

/** Cada llave vale para un solo ambiente, y es la que dice a cuál hablarle. */
export function apiDeWompi(llave: string): string {
  return llave.includes("_prod_") ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
}

function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

/** `<referencia><centavos><moneda>[<expiración>]<secreto de integridad>`, en SHA-256. */
export function firmaDeIntegridad(entrada: {
  referencia: string;
  centavos: number;
  moneda: string;
  expiracion?: string;
  secreto: string;
}): string {
  return sha256(
    `${entrada.referencia}${entrada.centavos}${entrada.moneda}${entrada.expiracion ?? ""}${entrada.secreto}`,
  );
}

export function urlDeCheckout(entrada: {
  llavePublica: string;
  secretoIntegridad: string;
  referencia: string;
  centavos: number;
  urlDeRetorno: string;
  correo?: string;
  expiracion?: string;
}): string {
  const moneda = "COP";
  const parametros = new URLSearchParams({
    "public-key": entrada.llavePublica,
    currency: moneda,
    "amount-in-cents": String(entrada.centavos),
    reference: entrada.referencia,
    "signature:integrity": firmaDeIntegridad({
      referencia: entrada.referencia,
      centavos: entrada.centavos,
      moneda,
      ...(entrada.expiracion ? { expiracion: entrada.expiracion } : {}),
      secreto: entrada.secretoIntegridad,
    }),
    "redirect-url": entrada.urlDeRetorno,
  });
  if (entrada.correo) parametros.set("customer-data:email", entrada.correo);
  if (entrada.expiracion) parametros.set("expiration-time", entrada.expiracion);
  return `${CHECKOUT}?${parametros.toString()}`;
}

export type TransaccionWompi = {
  readonly id: string;
  readonly referencia: string;
  readonly estado: string;
  readonly centavos: number;
  readonly moneda: string;
  readonly metodo: string | null;
};

function leerRuta(raiz: unknown, ruta: string): unknown {
  let actual = raiz;
  for (const parte of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

/**
 * Comprueba que el evento lo firmó Wompi.
 *
 * La lista de propiedades firmadas viene en cada evento y Wompi avisa de que
 * puede cambiar, por eso se lee de ahí y no se escribe a mano.
 */
export function eventoAutentico(evento: unknown, secreto: string, cabecera?: string | null): boolean {
  if (!secreto) return false;
  const propiedades = leerRuta(evento, "signature.properties");
  const firmado = cabecera ?? leerRuta(evento, "signature.checksum");
  const instante = leerRuta(evento, "timestamp");
  if (!Array.isArray(propiedades) || propiedades.length === 0) return false;
  if (typeof firmado !== "string" || (typeof instante !== "number" && typeof instante !== "string")) return false;

  let cadena = "";
  for (const propiedad of propiedades) {
    if (typeof propiedad !== "string") return false;
    const valor = leerRuta(evento, `data.${propiedad}`);
    if (valor === undefined || valor === null) return false;
    cadena += String(valor);
  }

  const esperado = Buffer.from(sha256(`${cadena}${instante}${secreto}`), "utf8");
  const recibido = Buffer.from(firmado.toLowerCase(), "utf8");
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

/** La transacción de un `transaction.updated`, o `null` si el evento es de otra cosa. */
export function transaccionDelEvento(evento: unknown): TransaccionWompi | null {
  if (leerRuta(evento, "event") !== "transaction.updated") return null;
  const id = leerRuta(evento, "data.transaction.id");
  const referencia = leerRuta(evento, "data.transaction.reference");
  const estado = leerRuta(evento, "data.transaction.status");
  const centavos = leerRuta(evento, "data.transaction.amount_in_cents");
  const moneda = leerRuta(evento, "data.transaction.currency");
  const metodo = leerRuta(evento, "data.transaction.payment_method_type");
  if (
    typeof id !== "string" ||
    typeof referencia !== "string" ||
    typeof estado !== "string" ||
    typeof centavos !== "number" ||
    typeof moneda !== "string"
  ) {
    return null;
  }
  return { id, referencia, estado, centavos, moneda, metodo: typeof metodo === "string" ? metodo : null };
}

export type ResultadoCobro =
  | { readonly tipo: "aceptado"; readonly id: string; readonly estado: string }
  /** Wompi lo rechazó de plano: no hay transacción y se puede dar por fallido. */
  | { readonly tipo: "rechazado"; readonly motivo: string }
  /** No se sabe qué pasó: el cobro pudo entrar. Decide el evento, si llega. */
  | { readonly tipo: "incierto"; readonly motivo: string };

/**
 * Cobra a una tarjeta registrada, sin el cliente presente.
 *
 * NO abona créditos: eso lo hace solo el evento `transaction.updated`, igual que
 * en una recarga manual. Un único camino de abono es lo que impide abonar dos veces.
 *
 * `recurrent: false` es lo que pide Wompi para cobros sin periodicidad fija.
 */
export async function cobrarConFuenteDePago(
  entrada: {
    llavePrivada: string;
    secretoIntegridad: string;
    fuenteDePago: number;
    referencia: string;
    centavos: number;
    correo: string;
  },
  peticion: typeof fetch = fetch,
): Promise<ResultadoCobro> {
  const moneda = "COP";
  try {
    const respuesta = await peticion(`${apiDeWompi(entrada.llavePrivada)}/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${entrada.llavePrivada}` },
      body: JSON.stringify({
        amount_in_cents: entrada.centavos,
        currency: moneda,
        signature: firmaDeIntegridad({
          referencia: entrada.referencia,
          centavos: entrada.centavos,
          moneda,
          secreto: entrada.secretoIntegridad,
        }),
        customer_email: entrada.correo,
        payment_method: { installments: 1 },
        reference: entrada.referencia,
        payment_source_id: entrada.fuenteDePago,
        recurrent: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await respuesta.text();
    if (respuesta.status >= 500) return { tipo: "incierto", motivo: `Wompi respondió ${respuesta.status}` };
    if (!respuesta.ok) return { tipo: "rechazado", motivo: `${respuesta.status}: ${texto.slice(0, 300)}` };
    const datos = JSON.parse(texto) as { data?: { id?: string; status?: string } };
    if (!datos.data?.id) return { tipo: "incierto", motivo: "Wompi no devolvió el identificador" };
    return { tipo: "aceptado", id: datos.data.id, estado: datos.data.status ?? "PENDING" };
  } catch (e) {
    return { tipo: "incierto", motivo: e instanceof Error ? e.message : String(e) };
  }
}

export type TokensDeAceptacion = {
  readonly politica: { readonly token: string; readonly enlace: string };
  readonly datosPersonales: { readonly token: string; readonly enlace: string };
};

/** Los dos contratos que el cliente debe aceptar antes de registrar una tarjeta. */
export async function tokensDeAceptacion(
  llavePublica: string,
  peticion: typeof fetch = fetch,
): Promise<TokensDeAceptacion | null> {
  try {
    const respuesta = await peticion(`${apiDeWompi(llavePublica)}/merchants/info`, {
      headers: { "x-merchant-public-key": llavePublica },
      signal: AbortSignal.timeout(8_000),
    });
    if (!respuesta.ok) return null;
    const { data } = (await respuesta.json()) as {
      data?: {
        presigned_acceptance?: { acceptance_token?: string; permalink?: string };
        presigned_personal_data_auth?: { acceptance_token?: string; permalink?: string };
      };
    };
    const a = data?.presigned_acceptance;
    const b = data?.presigned_personal_data_auth;
    if (!a?.acceptance_token || !a.permalink || !b?.acceptance_token || !b.permalink) return null;
    return {
      politica: { token: a.acceptance_token, enlace: a.permalink },
      datosPersonales: { token: b.acceptance_token, enlace: b.permalink },
    };
  } catch {
    return null;
  }
}

export type FuenteCreada =
  | { readonly ok: true; readonly id: number; readonly etiqueta: string }
  | { readonly ok: false; readonly motivo: string };

/** Registra la tarjeta ya tokenizada. Strappy nunca ve el número: solo el token. */
export async function crearFuenteDePago(
  entrada: {
    llavePrivada: string;
    token: string;
    correo: string;
    aceptacion: string;
    datosPersonales: string;
  },
  peticion: typeof fetch = fetch,
): Promise<FuenteCreada> {
  try {
    const respuesta = await peticion(`${apiDeWompi(entrada.llavePrivada)}/payment_sources`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${entrada.llavePrivada}` },
      body: JSON.stringify({
        type: "CARD",
        token: entrada.token,
        customer_email: entrada.correo,
        acceptance_token: entrada.aceptacion,
        accept_personal_auth: entrada.datosPersonales,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const datos = (await respuesta.json().catch(() => ({}))) as {
      data?: { id?: number; status?: string; public_data?: { brand?: string; last_four?: string } };
    };
    if (!respuesta.ok || typeof datos.data?.id !== "number") {
      return { ok: false, motivo: "Wompi no aceptó esta tarjeta. Revisa los datos o prueba con otra." };
    }
    if (datos.data.status !== "AVAILABLE") {
      return { ok: false, motivo: "La tarjeta quedó sin habilitar para cobros. Prueba con otra." };
    }
    const { brand, last_four: ultimos } = datos.data.public_data ?? {};
    const etiqueta = [brand, ultimos ? `terminada en ${ultimos}` : null].filter(Boolean).join(" ");
    return { ok: true, id: datos.data.id, etiqueta: etiqueta || "Tarjeta registrada" };
  } catch {
    return { ok: false, motivo: "No se pudo contactar con Wompi. Inténtalo de nuevo." };
  }
}
