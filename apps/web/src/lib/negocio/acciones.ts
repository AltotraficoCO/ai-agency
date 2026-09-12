"use server";

/**
 * Acciones de servidor de la corriente de negocio.
 *
 * Todas empiezan igual: `exigirUsuarioActual()` y comprobación de papel. Una
 * acción de servidor es un endpoint público —el cliente puede invocarla con el
 * identificador que quiera—, así que el espacio SIEMPRE se toma de la sesión y
 * jamás de los argumentos. Aceptar un `workspaceId` de fuera sería regalar el
 * aislamiento entre clientes.
 */
import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import { conEspacio, consultar } from "@/lib/db/pool";
import { cancelarAgente, contratarAgente } from "./catalogo";
import { limitesAAjustes, type LimitesGasto } from "./limites";

const PAPELES_DE_MANDO = new Set(["owner", "admin"]);

export type Resultado = { ok: true; mensaje?: string; destino?: string } | { ok: false; error: string };

// ── Contratación ────────────────────────────────────────────────────────────

export async function accionContratar(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol) && usuario.rol !== "builder") {
    return { ok: false, error: "No tienes permiso para contratar agentes en este espacio." };
  }

  const slug = String(datos.get("slug") ?? "");
  if (!slug) return { ok: false, error: "Falta el agente que quieres contratar." };

  const ajustes: Record<string, string> = {};
  for (const [clave, valor] of datos.entries()) {
    if (clave.startsWith("campo_") && typeof valor === "string") {
      ajustes[clave.slice("campo_".length)] = valor;
    }
  }

  const resultado = await contratarAgente({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    slug,
    nombre: String(datos.get("nombre") ?? ""),
    ajustes,
  });

  if (!resultado.ok) return { ok: false, error: resultado.motivo };

  revalidatePath("/contratar");
  revalidatePath("/agentes");
  // El agente queda en borrador: el siguiente paso es PROBARLO, no publicarlo.
  return { ok: true, destino: `/agentes/${resultado.agenteId}/probar` };
}

/**
 * Dar de baja un agente contratado.
 *
 * No borra nada: el contrato se cancela y el agente pasa a borrador, así que
 * sus instrucciones y su conocimiento siguen ahí si el cliente lo vuelve a
 * contratar. Lo que sí se apaga es la vigilancia del sitio cuando el que se va
 * es el Webmaster.
 */
export async function accionCancelarAgente(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el dueño o un administrador pueden dar de baja a un agente." };
  }

  const slug = String(datos.get("slug") ?? "");
  if (!slug) return { ok: false, error: "Falta el agente que quieres dar de baja." };

  const resultado = await cancelarAgente({ workspaceId: usuario.workspaceId, slug });
  if (!resultado.ok) return { ok: false, error: resultado.motivo };

  revalidatePath("/contratar");
  revalidatePath(`/contratar/${slug}`);
  revalidatePath("/agentes");
  return { ok: true, mensaje: "El agente ya no trabaja para ti. Puedes volver a contratarlo cuando quieras." };
}

// ── Espacio ─────────────────────────────────────────────────────────────────

export async function accionGuardarEspacio(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden cambiar el espacio." };
  }

  const nombre = String(datos.get("nombre") ?? "").trim();
  const zona = String(datos.get("zona") ?? "").trim();
  if (!nombre) return { ok: false, error: "El espacio necesita un nombre." };

  const horario = {
    dias: datos.getAll("dias").map(String),
    desde: String(datos.get("desde") ?? "09:00"),
    hasta: String(datos.get("hasta") ?? "18:00"),
    fuera_de_horario: String(datos.get("fuera_de_horario") ?? ""),
  };

  // `workspaces` no admite escritura del rol acotado (su política de worker es
  // solo de lectura), así que la actualización va por la conexión transversal
  // DESPUÉS de comprobar el papel arriba. El identificador sale de la sesión.
  await consultar(
    `update public.workspaces
        set name = $2,
            timezone = coalesce(nullif($3, ''), timezone),
            settings = settings || jsonb_build_object('horario_atencion', $4::jsonb),
            updated_at = now()
      where id = $1`,
    [usuario.workspaceId, nombre, zona, JSON.stringify(horario)],
  );

  revalidatePath("/ajustes/espacio");
  return { ok: true, mensaje: "Ajustes del espacio guardados." };
}

export async function accionGuardarLimites(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden cambiar los topes." };
  }

  const limites: LimitesGasto = {
    diario: entero(datos.get("diario")),
    porConversacion: entero(datos.get("por_conversacion")),
    parada: datos.get("parada") === "blanda" ? "blanda" : "dura",
  };

  await consultar(
    `update public.workspaces
        set settings = settings || $2::jsonb, updated_at = now()
      where id = $1`,
    [usuario.workspaceId, JSON.stringify(limitesAAjustes(limites))],
  );

  revalidatePath("/ajustes/facturacion");
  return { ok: true, mensaje: "Topes de gasto guardados." };
}

// ── Equipo ──────────────────────────────────────────────────────────────────

export async function accionInvitar(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden invitar." };
  }

  const correo = String(datos.get("correo") ?? "").trim().toLowerCase();
  const rol = String(datos.get("rol") ?? "agent");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    return { ok: false, error: "Ese correo no parece válido." };
  }
  if (!["admin", "agent", "analyst"].includes(rol)) {
    return { ok: false, error: "Ese papel no existe." };
  }

  // Solo se guarda el HASH del testigo: el enlace viaja por correo y no debe
  // quedar en la base, donde cualquiera con acceso de lectura podría usarlo.
  const testigo = crypto.randomUUID().replaceAll("-", "");
  const hash = await sha256(testigo);

  await conEspacio(usuario.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.invitations (workspace_id, email, role, token_hash, invited_by)
       values ($1, $2, $3, $4, $5)
       on conflict (workspace_id, lower(email)) where accepted_at is null and revoked_at is null
       do update set role = excluded.role, token_hash = excluded.token_hash,
                     expires_at = now() + interval '7 days'`,
      [usuario.workspaceId, correo, rol, hash, usuario.id],
    );
  });

  revalidatePath("/ajustes/equipo");
  return { ok: true, mensaje: `Invitación enviada a ${correo}.` };
}

export async function accionRevocarInvitacion(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden revocar invitaciones." };
  }
  const id = String(datos.get("id") ?? "");
  await conEspacio(usuario.workspaceId, async (scope) => {
    await scope.query(
      `update public.invitations set revoked_at = now()
        where workspace_id = $1 and id = $2 and accepted_at is null`,
      [usuario.workspaceId, id],
    );
  });
  revalidatePath("/ajustes/equipo");
  return { ok: true, mensaje: "Invitación revocada." };
}

export async function accionCambiarPapel(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden cambiar papeles." };
  }
  const miembroId = String(datos.get("id") ?? "");
  const rol = String(datos.get("rol") ?? "");
  if (!["admin", "agent", "analyst"].includes(rol)) {
    return { ok: false, error: "Ese papel no existe." };
  }

  // Nunca se toca al propietario desde aquí: si un administrador pudiera
  // degradarlo, un espacio podría quedarse sin nadie que pueda facturar.
  const filas = await consultar<{ id: string }>(
    `update public.memberships
        set role = $3, updated_at = now()
      where workspace_id = $1 and id = $2 and role <> 'owner'
      returning id`,
    [usuario.workspaceId, miembroId, rol],
  );
  if (filas.length === 0) return { ok: false, error: "No se pudo cambiar ese papel." };

  revalidatePath("/ajustes/equipo");
  return { ok: true, mensaje: "Papel actualizado." };
}

function entero(valor: FormDataEntryValue | null): number | null {
  const n = Number(String(valor ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function sha256(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const resumen = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
