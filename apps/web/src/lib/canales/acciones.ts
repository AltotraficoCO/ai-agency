"use server";

/**
 * Quitar lo conectado en Ajustes → Canales.
 *
 * Igual que en el resto de acciones: el espacio sale SIEMPRE de la sesión, y
 * solo el propietario o un administrador pueden desconectar, que es lo mismo
 * que hace falta para conectar.
 *
 * Dos decisiones que no son obvias:
 *
 *  · **Una plataforma de anuncios no se borra: se revoca.** La fila de
 *    `connections` la referencian los encargos y las aprobaciones ya hechas;
 *    borrarla se llevaría por delante ese historial. Se pone en `revoked` y se
 *    vacían las credenciales, que es lo que promete la política de privacidad
 *    («si desconectas una herramienta, su credencial se borra en el momento»).
 *    Reconectar la misma plataforma reutiliza la fila y la vuelve a activar.
 *  · **Un número de WhatsApp se elimina, pero su canal se conserva.** Las
 *    conversaciones cuelgan del canal, no del número: borrar el canal
 *    borraría el historial de todo lo que se habló por ahí. El canal queda
 *    `disconnected`, el número desaparece y Meta deja de poder entregarnos
 *    mensajes para él, porque el webhook ya no encuentra a quién pertenecen.
 */
import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import { conEspacio } from "@/lib/db/pool";
import { esPlataformaDeAnuncios, RUTA_CANALES } from "@/lib/canales/anuncios";
import { NOMBRE_PLATAFORMA } from "@strappy/marketing";

const PAPELES_DE_MANDO = new Set(["owner", "admin"]);

export type ResultadoCanal = { ok: true; mensaje: string } | { ok: false; error: string };

export async function accionDesconectarAnuncios(datos: FormData): Promise<ResultadoCanal> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden desconectar una plataforma." };
  }
  const plataforma = String(datos.get("plataforma") ?? "");
  if (!esPlataformaDeAnuncios(plataforma)) return { ok: false, error: "Esa plataforma de anuncios no existe." };

  const filas = await conEspacio(usuario.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string }>(
      `update public.connections
          set status = 'revoked', credentials_encrypted = null, updated_at = now()
        where workspace_id = $1 and provider = $2 and status = 'active'
        returning id`,
      [scope.workspaceId, plataforma],
    );
    return rows.length;
  });
  if (filas === 0) return { ok: false, error: `${NOMBRE_PLATAFORMA[plataforma]} no estaba conectado.` };

  revalidatePath(RUTA_CANALES);
  revalidatePath("/contratar");
  return { ok: true, mensaje: `${NOMBRE_PLATAFORMA[plataforma]} quedó desconectado. Tu agente de marketing ya no puede ver esas cuentas.` };
}

export async function accionEliminarNumeroWhatsApp(datos: FormData): Promise<ResultadoCanal> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden eliminar un número." };
  }
  const id = String(datos.get("id") ?? "");
  if (!id) return { ok: false, error: "Falta el número que quieres eliminar." };

  const numero = await conEspacio(usuario.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ numero: string; channel_id: string; account_id: string }>(
      `delete from public.whatsapp_numbers
        where workspace_id = $1 and id = $2
        returning display_phone_number as numero, channel_id, account_id`,
      [scope.workspaceId, id],
    );
    const borrado = rows[0];
    if (!borrado) return null;
    // Si la cuenta de Meta se queda sin números, el canal ya no atiende nada.
    const { rows: restantes } = await scope.query<{ n: string }>(
      `select count(*)::text as n from public.whatsapp_numbers where account_id = $1`,
      [borrado.account_id],
    );
    if (Number(restantes[0]?.n ?? 0) === 0) {
      await scope.query(
        `update public.channels
            set status = 'disconnected', status_detail = 'Número eliminado desde Ajustes → Canales', updated_at = now()
          where workspace_id = $1 and id = $2`,
        [scope.workspaceId, borrado.channel_id],
      );
    }
    return borrado.numero;
  });
  if (!numero) return { ok: false, error: "Ese número ya no está en tu espacio." };

  revalidatePath(RUTA_CANALES);
  revalidatePath("/contratar");
  return { ok: true, mensaje: `El número ${numero} quedó eliminado. Las conversaciones que ya tenías se conservan.` };
}
