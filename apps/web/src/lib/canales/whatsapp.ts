import "server-only";

/**
 * Conectar WhatsApp desde Ajustes → Canales.
 *
 * El registro en sí (`ejecutarRegistro`) vive en `@strappy/whatsapp` y no sabe
 * de Postgres ni de Next. Aquí está lo que ese paquete no puede saber:
 *
 *  · Qué diálogo abrir. Embedded Signup exige que la app de Meta sea Tech
 *    Provider aprobado, y la nuestra aún no lo es: Meta rechaza el diálogo
 *    pidiendo un `config_id`. Se usa el OAuth clásico con permisos, que es el
 *    que ya funciona en Varylo con esta misma app.
 *  · Dónde se guarda cada paso. El token y el PIN van cifrados con
 *    `ENCRYPTION_KEY`; el paso y el último error, en `channels.settings`, que es
 *    lo que pinta la pantalla.
 *  · Qué cuenta y qué número eligió el cliente. Con el diálogo por redirección
 *    Meta no los devuelve: se leen del token con `debug_token` y de la lista de
 *    números. Por eso el registro arranca en «verificar permisos», con el token
 *    ya canjeado.
 *  · A qué URL van los webhooks. La app de Meta se comparte con Varylo, así que
 *    cada WABA se suscribe con la URL de Strappy o sus mensajes llegarían allí.
 */
import { cifrar, descifrar, leerClave } from "@strappy/db";
import {
  crearClienteWhatsApp,
  ejecutarRegistro,
  urlOAuthPermisos,
  VERSION_SIGNUP,
  WhatsAppApiError,
  type EstadoRegistro,
  type PhoneNumberInfo,
  type ResumenCuenta,
} from "@strappy/whatsapp";
import { conEspacio } from "@/lib/db/pool";

export const RUTA_CANALES = "/ajustes/canales";
export const RUTA_CONECTAR = "/api/canales/whatsapp/conectar";
const RUTA_RETORNO = "/api/canales/whatsapp/retorno";
const RUTA_WEBHOOK = "/api/webhooks/whatsapp";

/** El enlace de conexión caduca: un `state` viejo reutilizado no debe servir. */
const VIGENCIA_ESTADO_MS = 15 * 60_000;

type ConfigMeta = { appId: string; appSecret: string; verifyToken: string };
type Filas = { canalId: string; cuentaId: string };

/** Credenciales de la app de Meta. `null` si falta cualquiera: la pantalla lo dice. */
export function configMeta(): ConfigMeta | null {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!appId || !appSecret || !verifyToken || !process.env.ENCRYPTION_KEY) return null;
  return { appId, appSecret, verifyToken };
}

function clave(): Buffer {
  return leerClave(process.env.ENCRYPTION_KEY);
}

/** Vuelta a la pantalla de Canales con el resultado en la URL. */
export function urlDeResultado(origen: string, resultado: "ok" | "error", detalle: string): URL {
  const url = new URL(RUTA_CANALES, origen);
  url.searchParams.set("whatsapp", resultado);
  url.searchParams.set("detalle", detalle);
  return url;
}

/** A dónde mandar al navegador para abrir el diálogo de Meta. `null` sin configuración. */
export function urlDeConexion(input: { origen: string; workspaceId: string; userId: string }): string | null {
  const config = configMeta();
  if (!config) return null;
  const state = cifrar(
    JSON.stringify({ w: input.workspaceId, u: input.userId, exp: Date.now() + VIGENCIA_ESTADO_MS }),
    clave(),
  );
  return urlOAuthPermisos({
    appId: config.appId,
    redirectUri: new URL(RUTA_RETORNO, input.origen).toString(),
    state,
  });
}

/**
 * Lee el `state` que vuelve de Meta. Va cifrado y autenticado (AES-GCM): si
 * alguien lo altera, `descifrar` falla; si caducó, se rechaza igual. Quien lo
 * llama comprueba además que sea del mismo usuario y del mismo espacio.
 */
export function leerEstadoOAuth(state: string): { workspaceId: string; userId: string } | null {
  try {
    const datos = JSON.parse(descifrar(state, clave())) as { w?: unknown; u?: unknown; exp?: unknown };
    if (typeof datos.w !== "string" || typeof datos.u !== "string" || typeof datos.exp !== "number") {
      return null;
    }
    if (datos.exp < Date.now()) return null;
    return { workspaceId: datos.w, userId: datos.u };
  } catch {
    return null;
  }
}

export type ResultadoConexion = { ok: true; numero: string } | { ok: false; mensaje: string };

export async function completarConexion(input: {
  origen: string;
  code: string;
  workspaceId: string;
}): Promise<ResultadoConexion> {
  const config = configMeta();
  if (!config) return { ok: false, mensaje: "Falta configurar la app de Meta en el servidor." };
  const app = { appId: config.appId, appSecret: config.appSecret };

  // 1. El `code` caduca en segundos y es de un solo uso: se canjea antes que nada.
  let accessToken: string;
  let tokenExpiraEn: Date | null;
  try {
    const token = await crearClienteWhatsApp({
      accessToken: `${app.appId}|${app.appSecret}`,
    }).intercambiarCodigo({
      ...app,
      code: input.code,
      redirectUri: new URL(RUTA_RETORNO, input.origen).toString(),
    });
    if (!token.access_token) throw new Error("Meta no devolvió un token de acceso.");
    accessToken = token.access_token;
    tokenExpiraEn = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  } catch (error) {
    return {
      ok: false,
      mensaje: `No pudimos completar la conexión con Meta. Vuelve a intentarlo. (${detalleDe(error)})`,
    };
  }

  // 2. Qué cuenta y qué número eligió en el diálogo.
  const api = crearClienteWhatsApp({ accessToken });
  let wabaId: string | undefined;
  let numero: PhoneNumberInfo | undefined;
  try {
    const info = await api.depurarToken({ inputToken: accessToken, ...app });
    wabaId = info.data?.granular_scopes
      ?.find((g) => g.scope === "whatsapp_business_management")
      ?.target_ids?.[0];
    if (wabaId) numero = (await api.listarNumeros(wabaId)).data?.find((n) => n.id);
  } catch (error) {
    return { ok: false, mensaje: `No pudimos leer tu cuenta de WhatsApp Business. (${detalleDe(error)})` };
  }
  if (!wabaId) {
    return {
      ok: false,
      mensaje:
        "Meta no nos dio acceso a ninguna cuenta de WhatsApp Business. Vuelve a conectar y elige la cuenta y el número.",
    };
  }
  const phoneNumberId = numero?.id;
  if (!numero || !phoneNumberId) {
    return {
      ok: false,
      mensaje: "Tu cuenta de WhatsApp Business no tiene ningún número. Añade uno en Meta y vuelve a conectar.",
    };
  }

  // 3. Las filas existen ANTES de registrar: cada paso se guarda sobre ellas.
  let filas: Filas & { pinCifrado: string | null };
  try {
    filas = await asegurarFilas({
      workspaceId: input.workspaceId,
      wabaId,
      phoneNumberId,
      numero,
      accessToken,
      tokenExpiraEn,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return {
        ok: false,
        mensaje: "Esta cuenta o este número de WhatsApp ya están conectados en otro espacio de Strappy.",
      };
    }
    throw error;
  }

  // 4. El registro, desde «verificar permisos»: el token ya está canjeado. Si
  // hubo un intento anterior se reutiliza su PIN; Meta rechaza uno distinto.
  const resultado = await ejecutarRegistro(
    {
      estado: {
        paso: "verificar_permisos",
        wabaId,
        phoneNumberId,
        signupVersion: VERSION_SIGNUP,
        accessToken,
        tokenExpiraEn,
        ...(filas.pinCifrado ? { pin: descifrar(filas.pinCifrado, clave()) } : {}),
      },
    },
    {
      app,
      webhook: { url: new URL(RUTA_WEBHOOK, input.origen).toString(), verifyToken: config.verifyToken },
      guardarEstado: (estado) => guardarPaso(input.workspaceId, filas, estado),
    },
  );

  if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
  await guardarResumen(input.workspaceId, filas, resultado.resumen);
  return {
    ok: true,
    numero: resultado.resumen.displayPhoneNumber ?? numero.display_phone_number ?? phoneNumberId,
  };
}

async function asegurarFilas(input: {
  workspaceId: string;
  wabaId: string;
  phoneNumberId: string;
  numero: PhoneNumberInfo;
  accessToken: string;
  tokenExpiraEn: Date | null;
}): Promise<Filas & { pinCifrado: string | null }> {
  const tokenCifrado = cifrar(input.accessToken, clave());
  const nombre = input.numero.verified_name ?? input.numero.display_phone_number ?? "WhatsApp";

  return conEspacio(input.workspaceId, async (scope) => {
    const existente = await scope.query<{ canal_id: string; cuenta_id: string; pin_cifrado: string | null }>(
      `select a.channel_id as canal_id, a.id as cuenta_id,
              c.settings #>> '{registro,pin_cifrado}' as pin_cifrado
         from public.whatsapp_accounts a
         join public.channels c on c.id = a.channel_id
        where a.workspace_id = $1 and a.waba_id = $2`,
      [input.workspaceId, input.wabaId],
    );

    let canalId: string;
    let cuentaId: string;
    let pinCifrado: string | null = null;
    const fila = existente.rows[0];

    if (fila) {
      canalId = fila.canal_id;
      cuentaId = fila.cuenta_id;
      pinCifrado = fila.pin_cifrado;
      await scope.query(
        `update public.whatsapp_accounts
            set access_token_encrypted = $3, key_version = 1, token_expires_at = $4, signup_version = $5
          where workspace_id = $1 and id = $2`,
        [input.workspaceId, cuentaId, tokenCifrado, input.tokenExpiraEn, VERSION_SIGNUP],
      );
    } else {
      const canal = await scope.query<{ id: string }>(
        `insert into public.channels (workspace_id, kind, name, status)
         values ($1, 'whatsapp', $2, 'pending')
         returning id`,
        [input.workspaceId, nombre],
      );
      canalId = primerId(canal.rows);
      const cuenta = await scope.query<{ id: string }>(
        `insert into public.whatsapp_accounts
           (workspace_id, channel_id, waba_id, access_token_encrypted, key_version, token_expires_at, signup_version)
         values ($1, $2, $3, $4, 1, $5, $6)
         returning id`,
        [input.workspaceId, canalId, input.wabaId, tokenCifrado, input.tokenExpiraEn, VERSION_SIGNUP],
      );
      cuentaId = primerId(cuenta.rows);
    }

    // En pausa hasta terminar el registro: el trigger ya crea la ruta del
    // webhook, pero inactiva, para que ningún mensaje entre a medio conectar.
    await scope.query(
      `insert into public.whatsapp_numbers
         (workspace_id, account_id, channel_id, phone_number_id, display_phone_number, verified_name, is_default, status)
       select $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
              not exists (select 1 from public.whatsapp_numbers
                           where workspace_id = $1::uuid and account_id = $2::uuid and is_default),
              'paused'
        where not exists (select 1 from public.whatsapp_numbers
                           where workspace_id = $1::uuid and phone_number_id = $4::text)`,
      [
        input.workspaceId,
        cuentaId,
        canalId,
        input.phoneNumberId,
        input.numero.display_phone_number ?? input.phoneNumberId,
        input.numero.verified_name ?? null,
      ],
    );

    return { canalId, cuentaId, pinCifrado };
  });
}

async function guardarPaso(workspaceId: string, filas: Filas, estado: EstadoRegistro): Promise<void> {
  const registro = {
    paso: estado.paso,
    ultimo_error: estado.ultimoError ?? null,
    app_suscrita: estado.appSuscrita ?? false,
    numero_registrado: estado.numeroRegistrado ?? false,
    pin_cifrado: estado.pin ? cifrar(estado.pin, clave()) : null,
    actualizado: new Date().toISOString(),
  };
  await conEspacio(workspaceId, async (scope) => {
    await scope.query(
      `update public.channels
          set settings = settings || jsonb_build_object('registro', $3::jsonb),
              status = case when $4::text is null then status else 'error' end,
              status_detail = $4::text
        where workspace_id = $1 and id = $2`,
      [workspaceId, filas.canalId, JSON.stringify(registro), estado.ultimoError?.mensaje ?? null],
    );
    await scope.query(
      `update public.whatsapp_accounts set webhook_subscribed = $3 where workspace_id = $1 and id = $2`,
      [workspaceId, filas.cuentaId, estado.appSuscrita ?? false],
    );
  });
}

const CALIDADES = new Set(["GREEN", "YELLOW", "RED", "UNKNOWN"]);
const REVISIONES = new Set(["pending", "approved", "rejected"]);

async function guardarResumen(workspaceId: string, filas: Filas, resumen: ResumenCuenta): Promise<void> {
  await conEspacio(workspaceId, async (scope) => {
    await scope.query(
      `update public.whatsapp_accounts
          set name = coalesce($3, name),
              payment_status = $4,
              account_review_status = $5,
              business_verification_status = $6,
              messaging_limit_tier = $7,
              last_sync_at = now()
        where workspace_id = $1 and id = $2`,
      [
        workspaceId,
        filas.cuentaId,
        resumen.nombreWaba ?? null,
        resumen.paymentStatus,
        REVISIONES.has(resumen.accountReviewStatus) ? resumen.accountReviewStatus : "pending",
        resumen.businessVerificationStatus,
        resumen.messagingTier,
      ],
    );
    await scope.query(
      `update public.whatsapp_numbers
          set display_phone_number = coalesce($3, display_phone_number),
              verified_name = coalesce($4, verified_name),
              quality_rating = $5,
              messaging_tier = $6,
              code_verification_status = $7,
              status = 'active'
        where workspace_id = $1 and phone_number_id = $2`,
      [
        workspaceId,
        resumen.phoneNumberId,
        resumen.displayPhoneNumber ?? null,
        resumen.verifiedName ?? null,
        CALIDADES.has(resumen.qualityRating) ? resumen.qualityRating : "UNKNOWN",
        resumen.messagingTier,
        resumen.codeVerificationStatus ?? null,
      ],
    );
    await scope.query(
      `update public.channels
          set status = 'connected',
              status_detail = null,
              connected_at = coalesce(connected_at, now()),
              name = coalesce($3, name)
        where workspace_id = $1 and id = $2`,
      [workspaceId, filas.canalId, resumen.verifiedName ?? null],
    );
  });
}

export type CanalWhatsApp = {
  id: string;
  numero: string;
  nombre: string | null;
  calidad: string;
  estadoNumero: string;
  estadoCanal: string;
  detalle: string | null;
  pago: string;
};

/** Lo que pinta la pantalla de Canales: un renglón por número conectado. */
export async function canalesDeWhatsApp(workspaceId: string): Promise<CanalWhatsApp[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      numero: string;
      nombre: string | null;
      calidad: string;
      estado_numero: string;
      estado_canal: string;
      detalle: string | null;
      pago: string;
    }>(
      `select n.id, n.display_phone_number as numero, n.verified_name as nombre,
              n.quality_rating as calidad, n.status as estado_numero,
              c.status as estado_canal, c.status_detail as detalle, a.payment_status as pago
         from public.whatsapp_numbers n
         join public.channels c on c.id = n.channel_id
         join public.whatsapp_accounts a on a.id = n.account_id
        where n.workspace_id = $1
        order by n.created_at`,
      [workspaceId],
    );
    return rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      nombre: r.nombre,
      calidad: r.calidad,
      estadoNumero: r.estado_numero,
      estadoCanal: r.estado_canal,
      detalle: r.detalle,
      pago: r.pago,
    }));
  });
}

function primerId(filas: { id: string }[]): string {
  const id = filas[0]?.id;
  if (!id) throw new Error("Postgres no devolvió el identificador de la fila insertada.");
  return id;
}

function detalleDe(error: unknown): string {
  if (error instanceof WhatsAppApiError) return error.decision.mensajeUsuario;
  return error instanceof Error ? error.message : String(error);
}
