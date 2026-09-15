import "server-only";

/**
 * Conectar las plataformas de anuncios desde Ajustes → Canales.
 *
 * El canje del permiso y las llamadas a cada plataforma viven en
 * `@strappy/marketing/adaptadores` y no saben de Postgres ni de Next. Aquí está
 * lo que ese paquete no puede saber: de quién es la cuenta, dónde se guarda y
 * qué se le enseña a la persona.
 *
 * Tres decisiones que no son obvias:
 *
 *  · **Se prueba antes de guardar.** Un permiso concedido no significa que haya
 *    una cuenta publicitaria detrás: se listan las cuentas y, si no hay
 *    ninguna, se dice ahí mismo. Guardar una conexión que el día del primer
 *    encargo resulta estar vacía convierte un problema de dos minutos en un
 *    encargo fallido una semana después.
 *  · **Una fila por plataforma y espacio.** El nombre de la conexión es el
 *    nombre de la plataforma, así que reconectar actualiza la fila en vez de
 *    duplicarla y los encargos que ya apuntaban a ella siguen valiendo.
 *  · **Las credenciales se cifran con `APP_ENCRYPTION_KEY`**, que es la clave
 *    con la que el worker descifra `connections` (ver
 *    `apps/worker/src/adaptadores/cuentas.ts`). El `state` del OAuth va con
 *    `ENCRYPTION_KEY`, que es la de la web. Son dos claves distintas a
 *    propósito: la de la web no abre las credenciales de nadie.
 */
import { cifrar, descifrar, leerClave } from "@strappy/db";
import { NOMBRE_PLATAFORMA, type Plataforma } from "@strappy/marketing";
import {
  AdsApiError,
  canjearGoogle,
  canjearMeta,
  canjearTiktok,
  crearAds,
  urlPermisoGoogle,
  urlPermisoMeta,
  urlPermisoTiktok,
  type CredencialesAds,
} from "@strappy/marketing/adaptadores";
import { encryptJson, masterKeyFromEnv } from "@strappy/webmaster/crypto";
import { conEspacio } from "@/lib/db/pool";

export const RUTA_CANALES = "/ajustes/canales";

/** El enlace de conexión caduca: un `state` viejo reutilizado no debe servir. */
const VIGENCIA_ESTADO_MS = 15 * 60_000;

/** Las tres plataformas, tal y como se nombran en la interfaz del cliente. */
export const PLATAFORMAS_ANUNCIOS = [
  {
    plataforma: "google_ads" as const,
    nombre: NOMBRE_PLATAFORMA.google_ads,
    descripcion: "Búsqueda, YouTube y display: en qué se va tu inversión y qué te trae clientes.",
  },
  {
    plataforma: "meta_ads" as const,
    nombre: NOMBRE_PLATAFORMA.meta_ads,
    descripcion: "Tus campañas de Facebook e Instagram, con el mismo criterio que las de Google.",
  },
  {
    plataforma: "tiktok_ads" as const,
    nombre: NOMBRE_PLATAFORMA.tiktok_ads,
    descripcion: "Tus campañas de TikTok, medidas con la misma vara que las demás.",
  },
] as const;

export function esPlataformaDeAnuncios(valor: string): valor is Plataforma {
  return PLATAFORMAS_ANUNCIOS.some((p) => p.plataforma === valor);
}

export function rutaConectar(plataforma: Plataforma): string {
  return `/api/canales/anuncios/${plataforma}/conectar`;
}

function rutaRetorno(plataforma: Plataforma): string {
  return `/api/canales/anuncios/${plataforma}/retorno`;
}

function redirectUri(origen: string, plataforma: Plataforma): string {
  return new URL(rutaRetorno(plataforma), origen).toString();
}

// ---------------------------------------------------------------------------
// Configuración del servidor
// ---------------------------------------------------------------------------

type ConfigPlataforma =
  | { plataforma: "google_ads"; clientId: string; clientSecret: string; developerToken: string }
  | { plataforma: "meta_ads"; appId: string; appSecret: string }
  | { plataforma: "tiktok_ads"; appId: string; secret: string };

/**
 * Las credenciales de NUESTRA app en cada plataforma. `null` si falta alguna.
 *
 * Las de Meta son las mismas que las de WhatsApp: es la misma app, con permisos
 * de anuncios añadidos. Las de Google necesitan además el `developer-token`,
 * que es lo que Google aprueba y sin lo cual la API contesta 403 a todo.
 */
export function configDe(plataforma: Plataforma): ConfigPlataforma | null {
  if (!process.env.ENCRYPTION_KEY || !process.env.APP_ENCRYPTION_KEY) return null;
  switch (plataforma) {
    case "google_ads": {
      const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
      const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
      return clientId && clientSecret && developerToken
        ? { plataforma, clientId, clientSecret, developerToken }
        : null;
    }
    case "meta_ads": {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      return appId && appSecret ? { plataforma, appId, appSecret } : null;
    }
    case "tiktok_ads": {
      const appId = process.env.TIKTOK_APP_ID;
      const secret = process.env.TIKTOK_APP_SECRET;
      return appId && secret ? { plataforma, appId, secret } : null;
    }
  }
}

function clave(): Buffer {
  return leerClave(process.env.ENCRYPTION_KEY);
}

/** Vuelta a Canales con el resultado en la URL. */
export function urlDeResultado(origen: string, resultado: "ok" | "error", detalle: string): URL {
  const url = new URL(RUTA_CANALES, origen);
  url.searchParams.set("anuncios", resultado);
  url.searchParams.set("detalle", detalle);
  return url;
}

// ---------------------------------------------------------------------------
// Ida y vuelta del permiso
// ---------------------------------------------------------------------------

/** A dónde mandar al navegador. `null` cuando falta configuración del servidor. */
export function urlDeConexion(input: {
  plataforma: Plataforma;
  origen: string;
  workspaceId: string;
  userId: string;
}): string | null {
  const config = configDe(input.plataforma);
  if (!config) return null;

  // El `state` va cifrado y autenticado: lleva de quién es, a qué espacio va y
  // cuándo caduca. La plataforma viaja dentro además de en la ruta para que un
  // retorno cruzado (el código de Meta llegando a la ruta de TikTok) no pase.
  const state = cifrar(
    JSON.stringify({
      w: input.workspaceId,
      u: input.userId,
      p: input.plataforma,
      exp: Date.now() + VIGENCIA_ESTADO_MS,
    }),
    clave(),
  );
  const uri = redirectUri(input.origen, input.plataforma);

  switch (config.plataforma) {
    case "google_ads":
      return urlPermisoGoogle({
        app: { clientId: config.clientId, clientSecret: config.clientSecret },
        redirectUri: uri,
        state,
      });
    case "meta_ads":
      return urlPermisoMeta({
        app: { appId: config.appId, appSecret: config.appSecret },
        redirectUri: uri,
        state,
      });
    case "tiktok_ads":
      return urlPermisoTiktok({ app: { appId: config.appId, secret: config.secret }, redirectUri: uri, state });
  }
}

export function leerEstado(
  state: string,
): { workspaceId: string; userId: string; plataforma: Plataforma } | null {
  try {
    const datos = JSON.parse(descifrar(state, clave())) as Record<string, unknown>;
    const { w, u, p, exp } = datos;
    if (typeof w !== "string" || typeof u !== "string" || typeof p !== "string") return null;
    if (typeof exp !== "number" || exp < Date.now()) return null;
    if (!esPlataformaDeAnuncios(p)) return null;
    return { workspaceId: w, userId: u, plataforma: p };
  } catch {
    return null;
  }
}

export type ResultadoConexion =
  | { ok: true; plataforma: Plataforma; cuentas: number }
  | { ok: false; mensaje: string };

export async function completarConexion(input: {
  origen: string;
  plataforma: Plataforma;
  code: string;
  workspaceId: string;
  usuarioId: string;
}): Promise<ResultadoConexion> {
  const config = configDe(input.plataforma);
  if (!config) {
    return { ok: false, mensaje: `Falta configurar ${NOMBRE_PLATAFORMA[input.plataforma]} en el servidor.` };
  }
  let claveMaestra: Buffer;
  try {
    claveMaestra = masterKeyFromEnv();
  } catch {
    return { ok: false, mensaje: "Falta configurar la clave de cifrado en el servidor." };
  }

  // 1. El código caduca en segundos y es de un solo uso: se canjea antes que nada.
  let credenciales: CredencialesAds;
  try {
    credenciales = await canjear(config, input.code, redirectUri(input.origen, input.plataforma));
  } catch (error) {
    return {
      ok: false,
      mensaje: `No pudimos completar la conexión con ${NOMBRE_PLATAFORMA[input.plataforma]}. (${detalleDe(error)})`,
    };
  }

  // 2. Un permiso concedido no es una cuenta publicitaria: se comprueba.
  let cuentas: readonly { nombre: string }[];
  try {
    cuentas = await crearAds(credenciales).cuentas();
  } catch (error) {
    return {
      ok: false,
      mensaje: `${NOMBRE_PLATAFORMA[input.plataforma]} no nos dejó leer tus cuentas. (${detalleDe(error)})`,
    };
  }
  if (cuentas.length === 0) {
    return {
      ok: false,
      mensaje:
        `El permiso llegó bien, pero esa cuenta de ${NOMBRE_PLATAFORMA[input.plataforma]} no tiene ninguna cuenta publicitaria activa. ` +
        "Vuelve a conectar eligiendo la cuenta desde la que anuncias.",
    };
  }

  // 3. Guardar. El nombre de la fila es el de la plataforma a propósito:
  // reconectar actualiza esta misma fila y los encargos que ya la apuntaban
  // siguen valiendo.
  await conEspacio(input.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.connections
         (workspace_id, provider, name, auth_type, credentials_encrypted, key_version,
          metadata, scopes, status, last_verified_at, created_by)
       values ($1, $2, $3, 'oauth2', $4, 1, $5::jsonb, $6::text[], 'active', now(), $7)
       on conflict (workspace_id, provider, name) do update set
         credentials_encrypted = excluded.credentials_encrypted,
         key_version = excluded.key_version,
         metadata = public.connections.metadata || excluded.metadata,
         scopes = excluded.scopes,
         status = 'active',
         last_verified_at = now(),
         updated_at = now()`,
      [
        input.workspaceId,
        input.plataforma,
        NOMBRE_PLATAFORMA[input.plataforma],
        encryptJson(credenciales.creds, claveMaestra),
        JSON.stringify({
          nombre: NOMBRE_PLATAFORMA[input.plataforma],
          cuentas: cuentas.map((c) => c.nombre).slice(0, 10),
          // El agente de Marketing mira desde el primer encargo; lo que mueve
          // dinero pasa por aprobación, así que no hace falta un modo de prueba
          // aparte. Si alguien quiere uno, es poner esto en true.
          primer_contacto: false,
        }),
        [],
        input.usuarioId,
      ],
    );
  });

  return { ok: true, plataforma: input.plataforma, cuentas: cuentas.length };
}

async function canjear(
  config: ConfigPlataforma,
  code: string,
  uri: string,
): Promise<CredencialesAds> {
  switch (config.plataforma) {
    case "google_ads":
      return {
        plataforma: "google_ads",
        creds: await canjearGoogle({
          app: { clientId: config.clientId, clientSecret: config.clientSecret },
          code,
          redirectUri: uri,
          developerToken: config.developerToken,
        }),
      };
    case "meta_ads":
      return {
        plataforma: "meta_ads",
        creds: await canjearMeta({
          app: { appId: config.appId, appSecret: config.appSecret },
          code,
          redirectUri: uri,
        }),
      };
    case "tiktok_ads":
      return {
        plataforma: "tiktok_ads",
        creds: await canjearTiktok({ app: { appId: config.appId, secret: config.secret }, code }),
      };
  }
}

// ---------------------------------------------------------------------------
// Lo que pinta la pantalla
// ---------------------------------------------------------------------------

export type ConexionDeAnuncios = {
  id: string;
  plataforma: Plataforma;
  nombre: string;
  /** Nombres de las cuentas publicitarias que se vieron al conectar. */
  cuentas: string[];
  estado: string;
  soloLectura: boolean;
  verificada: string | null;
};

export async function conexionesDeAnuncios(workspaceId: string): Promise<ConexionDeAnuncios[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      provider: string;
      nombre: string | null;
      cuentas: unknown;
      estado: string;
      solo_lectura: boolean | null;
      verificada: Date | null;
    }>(
      `select id, provider, metadata->>'nombre' as nombre, metadata->'cuentas' as cuentas,
              status as estado, (metadata->>'solo_lectura')::boolean as solo_lectura,
              last_verified_at as verificada
         from public.connections
        where workspace_id = $1 and provider = any($2::text[])
        order by updated_at desc`,
      [workspaceId, PLATAFORMAS_ANUNCIOS.map((p) => p.plataforma)],
    );

    return rows
      .filter((r): r is typeof r & { provider: Plataforma } => esPlataformaDeAnuncios(r.provider))
      .map((r) => ({
        id: r.id,
        plataforma: r.provider,
        nombre: r.nombre ?? NOMBRE_PLATAFORMA[r.provider],
        cuentas: Array.isArray(r.cuentas) ? r.cuentas.filter((c): c is string => typeof c === "string") : [],
        estado: r.estado,
        soloLectura: r.solo_lectura === true,
        verificada: r.verificada ? r.verificada.toISOString() : null,
      }));
  });
}

function detalleDe(error: unknown): string {
  const texto =
    error instanceof AdsApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return texto.length > 200 ? `${texto.slice(0, 197)}…` : texto;
}
