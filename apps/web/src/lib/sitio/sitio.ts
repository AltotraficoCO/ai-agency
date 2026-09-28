import "server-only";

/**
 * El sitio web que cuida el Webmaster.
 *
 * Vive en `public.connections` porque es de ahí de donde lo lee el worker (ver
 * `apps/worker/src/adaptadores/postgres.ts`): las credenciales van cifradas con
 * `APP_ENCRYPTION_KEY` —la clave del Webmaster, no la de WhatsApp— y la URL y
 * el tipo, en `metadata`. Si cualquiera de las dos cosas cambia de forma aquí,
 * el worker deja de encontrar el sitio sin que nada falle al guardar.
 *
 * Se prueba ANTES de guardar: una dirección con credenciales que no sirven no
 * es un sitio conectado, es una tarea que fallará a las tres de la mañana.
 */
import { encryptJson, masterKeyFromEnv } from "@strappy/webmaster/crypto";
import { health } from "@strappy/webmaster/wordpress";
import { conEspacio } from "@/lib/db/pool";

export type SitioGuardado = {
  id: string;
  url: string;
  nombre: string;
  usuario: string;
  estado: string;
  /** Cómo está hecho: WordPress, conector estándar o el repositorio de uno a medida. */
  tipo: "wp" | "custom" | "repo";
  /** owner/repo, si es un repositorio. */
  repositorio?: string;
};

/**
 * El sitio que cuida el Webmaster, o `null`: el WordPress, el sitio con el
 * conector o el repositorio de uno a medida, el último que se conectó. Es el
 * mismo que elige un encargo nuevo (`encargos.ts`), así que la pantalla nunca
 * dice «trabaja en X» mientras el encargo va a Y.
 */
export async function sitioDelEspacio(
  workspaceId: string,
  /** Solo el WordPress: el Diseñador publica en su biblioteca de medios y no sabe de otros. */
  soloWordpress = false,
): Promise<SitioGuardado | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      provider: string;
      url: string | null;
      nombre: string | null;
      usuario: string | null;
      owner: string | null;
      repo: string | null;
      estado: string;
    }>(
      `select id, provider, metadata->>'url' as url, metadata->>'nombre' as nombre,
              metadata->>'usuario' as usuario, metadata->>'owner' as owner,
              metadata->>'repo' as repo, status as estado
         from public.connections
        where workspace_id = $1 and provider = any($2::text[])
          and status <> 'revoked'
        order by (status = 'active') desc, updated_at desc
        limit 1`,
      [workspaceId, soloWordpress ? ["wordpress"] : ["wordpress", "conector", "github"]],
    );
    const fila = rows[0];
    if (!fila?.url) return null;
    const tipo = fila.provider === "github" ? "repo" : fila.provider === "conector" ? "custom" : "wp";
    return {
      id: fila.id,
      url: fila.url,
      nombre: fila.nombre ?? new URL(fila.url).hostname,
      usuario: fila.usuario ?? "",
      estado: fila.estado,
      tipo,
      ...(tipo === "repo" && fila.owner && fila.repo ? { repositorio: `${fila.owner}/${fila.repo}` } : {}),
    };
  });
}

/** El WordPress conectado, aunque el sitio activo sea otro: rellena su formulario. */
export async function wordpressDelEspacio(workspaceId: string): Promise<{ url: string; usuario: string } | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ url: string | null; usuario: string | null }>(
      `select metadata->>'url' as url, metadata->>'usuario' as usuario
         from public.connections
        where workspace_id = $1 and provider = 'wordpress'
        order by updated_at desc
        limit 1`,
      [workspaceId],
    );
    const f = rows[0];
    return f?.url ? { url: f.url, usuario: f.usuario ?? "" } : null;
  });
}

export type ResultadoSitio = { ok: true; nombre: string } | { ok: false; error: string };

export async function probarYGuardarSitio(input: {
  workspaceId: string;
  usuarioId: string;
  url: string;
  usuario: string;
  contrasena: string;
}): Promise<ResultadoSitio> {
  const url = normalizarUrl(input.url);
  if (!url) {
    return { ok: false, error: "Escribe la dirección de tu sitio, por ejemplo https://misitio.com." };
  }
  const usuario = input.usuario.trim();
  const appPassword = input.contrasena.trim();
  if (!usuario || !appPassword) {
    return { ok: false, error: "Faltan el usuario de WordPress o la contraseña de aplicación." };
  }

  let clave: Buffer;
  try {
    clave = masterKeyFromEnv();
  } catch {
    return { ok: false, error: "Falta configurar la clave de cifrado del Webmaster en el servidor." };
  }

  const credenciales = { url, user: usuario, appPassword };
  const salud = await health(credenciales);
  if (!salud.ok) {
    return {
      ok: false,
      error: `No pudimos entrar a la API de WordPress de ${url}. Revisa la dirección y que el sitio esté en línea. (${salud.error ?? "sin respuesta"})`,
    };
  }
  if (!salud.writable) {
    return {
      ok: false,
      error: `WordPress rechazó el usuario o la contraseña de aplicación. Recuerda que no es tu contraseña normal: se crea en tu perfil de WordPress, en «Contraseñas de aplicación». (${salud.error ?? "sin permiso"})`,
    };
  }

  const host = new URL(url).hostname;
  const nombre = salud.siteName?.trim() || host;

  // `name` es el host: reconectar el mismo sitio actualiza la fila en vez de
  // duplicarla, y el `id` que ya tengan las tareas del worker sigue valiendo.
  await conEspacio(input.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.connections
         (workspace_id, provider, name, auth_type, credentials_encrypted, key_version,
          metadata, status, last_verified_at, created_by)
       values ($1, 'wordpress', $2, 'basic', $3, 1, $4::jsonb, 'active', now(), $5)
       on conflict (workspace_id, provider, name) do update set
         credentials_encrypted = excluded.credentials_encrypted,
         key_version = excluded.key_version,
         metadata = public.connections.metadata || excluded.metadata,
         status = 'active',
         last_verified_at = now(),
         updated_at = now()`,
      [
        input.workspaceId,
        host,
        encryptJson(credenciales, clave),
        // `primer_contacto: false`: el Webmaster ejecuta desde el primer encargo
        // (con copia de seguridad y aprobación en lo delicado), no solo simula.
        JSON.stringify({ url, tipo: "wp", nombre, usuario, primer_contacto: false }),
        input.usuarioId,
      ],
    );
  });

  return { ok: true, nombre };
}

/** Acepta «misitio.com» o «https://misitio.com/»; devuelve el origen limpio o `null`. */
function normalizarUrl(valor: string): string | null {
  const texto = valor.trim();
  if (!texto) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
    if (!url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
