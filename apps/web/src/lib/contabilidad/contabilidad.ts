import "server-only";

/**
 * El sistema de facturación del negocio, que es de donde vive el agente financiero.
 *
 * Vive en `public.connections`, igual que el WordPress del Webmaster y por la
 * misma razón: es de ahí de donde lo lee el worker (ver
 * `apps/worker/src/adaptadores/libros.ts`). Las credenciales van cifradas con
 * `APP_ENCRYPTION_KEY` y lo que no es secreto —el nombre, el usuario, si la
 * conexión es de solo lectura— en `metadata`.
 *
 * Se prueba ANTES de guardar, y se prueba dos cosas distintas: que las
 * credenciales sirven para LEER y si además permiten EMITIR. Un usuario de
 * Alegra sin permiso para facturar es una conexión perfectamente útil —el
 * agente mira, analiza y propone—, pero hay que saberlo el día que se conecta y
 * no la primera vez que alguien le pide una factura.
 */
import { crearContabilidadAlegra } from "@strappy/administrativo/alegra";
import { encryptJson, masterKeyFromEnv } from "@strappy/webmaster/crypto";
import { conEspacio } from "@/lib/db/pool";

export type ContabilidadGuardada = {
  id: string;
  /** «Alegra», para poder nombrarlo en la interfaz. */
  sistema: string;
  nombre: string;
  usuario: string;
  estado: string;
  /** false cuando el usuario conectado no puede emitir documentos. */
  puedeEmitir: boolean;
};

/** El sistema de facturación conectado del espacio, o `null`. */
export async function contabilidadDelEspacio(
  workspaceId: string,
): Promise<ContabilidadGuardada | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      nombre: string | null;
      usuario: string | null;
      estado: string;
      solo_lectura: boolean | null;
    }>(
      `select id, metadata->>'nombre' as nombre, metadata->>'usuario' as usuario,
              status as estado, (metadata->>'solo_lectura')::boolean as solo_lectura
         from public.connections
        where workspace_id = $1 and provider = 'alegra'
        order by updated_at desc
        limit 1`,
      [workspaceId],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      id: fila.id,
      sistema: "Alegra",
      nombre: fila.nombre ?? "Alegra",
      usuario: fila.usuario ?? "",
      estado: fila.estado,
      puedeEmitir: fila.solo_lectura !== true,
    };
  });
}

export type ResultadoContabilidad =
  | { ok: true; nombre: string; puedeEmitir: boolean }
  | { ok: false; error: string };

export async function probarYGuardarContabilidad(input: {
  workspaceId: string;
  usuarioId: string;
  usuario: string;
  token: string;
  /** El cliente puede pedir expresamente que nadie emita en su nombre. */
  soloLectura?: boolean;
}): Promise<ResultadoContabilidad> {
  const usuario = input.usuario.trim();
  const token = input.token.trim();
  if (!usuario || !token) {
    return {
      ok: false,
      error: "Faltan el correo de tu usuario de Alegra o el token de la API.",
    };
  }
  if (!usuario.includes("@")) {
    return {
      ok: false,
      error: "El usuario de Alegra es el correo con el que entras, por ejemplo contabilidad@tunegocio.com.",
    };
  }

  let clave: Buffer;
  try {
    clave = masterKeyFromEnv();
  } catch {
    return { ok: false, error: "Falta configurar la clave de cifrado en el servidor." };
  }

  const credenciales = { usuario, secreto: token };
  const contabilidad = crearContabilidadAlegra(credenciales);

  // Prueba de lectura: si esto falla, no hay conexión que guardar.
  try {
    await contabilidad.facturas({ limite: 1 });
  } catch (error) {
    return {
      ok: false,
      error: `Alegra rechazó esos datos. Recuerda que el segundo dato es el TOKEN de la API (Configuración → API), no tu contraseña. (${recortar(error)})`,
    };
  }

  // Prueba de permisos: se busca un cliente, que es lo mínimo que hace falta
  // para poder emitir. No se crea nada: probar emitiendo una factura de verdad
  // dejaría un documento legal en la contabilidad del cliente.
  let puedeEmitir = input.soloLectura !== true;
  if (puedeEmitir) {
    try {
      await contabilidad.buscarClientes({ texto: "", limite: 1 });
    } catch {
      puedeEmitir = false;
    }
  }

  await conEspacio(input.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.connections
         (workspace_id, provider, name, auth_type, credentials_encrypted, key_version,
          metadata, status, last_verified_at, created_by)
       values ($1, 'alegra', $2, 'basic', $3, 1, $4::jsonb, 'active', now(), $5)
       on conflict (workspace_id, provider, name) do update set
         credentials_encrypted = excluded.credentials_encrypted,
         key_version = excluded.key_version,
         metadata = public.connections.metadata || excluded.metadata,
         status = 'active',
         last_verified_at = now(),
         updated_at = now()`,
      [
        input.workspaceId,
        // El usuario es el nombre de la conexión: reconectar la misma cuenta
        // actualiza la fila en vez de duplicarla, y el `id` que ya tengan los
        // encargos sigue valiendo.
        usuario,
        encryptJson(credenciales, clave),
        JSON.stringify({
          sistema: "Alegra",
          nombre: "Alegra",
          usuario,
          solo_lectura: !puedeEmitir,
          // El agente financiero mira desde el primer encargo; lo que emite
          // pasa por aprobación, así que no hace falta un modo de prueba aparte.
          primer_contacto: false,
        }),
        input.usuarioId,
      ],
    );
  });

  return { ok: true, nombre: "Alegra", puedeEmitir };
}

function recortar(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  return texto.length > 160 ? `${texto.slice(0, 157)}…` : texto;
}
