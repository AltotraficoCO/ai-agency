"use server";

/**
 * Lo que se cambia desde el panel de super admin.
 *
 * Una acción de servidor es un endpoint público: que la página no se pinte no
 * impide llamarla. Por eso CADA una comprueba quién llama, y deja constancia.
 */
import { revalidatePath } from "next/cache";
import { validarConfigCobro } from "@strappy/core/recargas";
import { validarLlaves, type LlavesWompi } from "@strappy/core/wompi";
import { cifrar } from "@strappy/db";
import { claveDePlataforma } from "@strappy/db/adapters";
import { conEspacio, consultar } from "@/lib/db/pool";
import { superAdminActual, type SuperAdmin } from "./acceso";
import { obtenerClaveDeCartera, obtenerLlavesWompi, olvidarAjustesRecordados } from "./config";
import { repartirDescuento } from "./ajustes";
import { comprobarClaveDeCartera, validarClaveDeCartera } from "./cartera";

export type ResultadoAdmin = { ok: true; mensaje: string } | { ok: false; error: string };

const NO_AUTORIZADO: ResultadoAdmin = { ok: false, error: "No autorizado." };

async function anotar(actor: SuperAdmin, accion: string, detalle: Record<string, unknown>, workspaceId?: string) {
  await consultar(
    `insert into public.platform_audit_log (actor_id, actor_email, action, workspace_id, detail)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actor.id, actor.correo, accion, workspaceId ?? null, JSON.stringify(detalle)],
  );
}

export async function guardarConfigCobro(datos: FormData): Promise<ResultadoAdmin> {
  const actor = await superAdminActual();
  if (!actor) return NO_AUTORIZADO;

  const validada = validarConfigCobro(Object.fromEntries(datos.entries()));
  if (!validada.ok) return { ok: false, error: validada.motivo };

  await consultar(
    `insert into public.platform_settings (key, value, updated_by, updated_at)
     values ('cobro', $1::jsonb, $2, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [JSON.stringify(validada.config), actor.id],
  );
  await anotar(actor, "cobro.config", { ...validada.config });
  olvidarAjustesRecordados();
  revalidatePath("/admin/cobro");
  return { ok: true, mensaje: "Guardado. Puede tardar hasta un minuto en llegar a todo el sistema." };
}

/** Una casilla vacía conserva lo que había: los secretos no se vuelven a mostrar. */
export async function guardarLlavesWompi(datos: FormData): Promise<ResultadoAdmin> {
  const actor = await superAdminActual();
  if (!actor) return NO_AUTORIZADO;

  const texto = (clave: string) => String(datos.get(clave) ?? "").trim();
  const previas = await obtenerLlavesWompi();
  const llaves: LlavesWompi = {
    publica: texto("publica") || previas.publica,
    privada: texto("privada") || previas.privada,
    integridad: texto("integridad") || previas.integridad,
    eventos: texto("eventos") || previas.eventos,
  };

  const validadas = validarLlaves(llaves);
  if (!validadas.ok) return { ok: false, error: validadas.motivo };

  let cifrado: string;
  try {
    const { privada, integridad, eventos } = llaves;
    cifrado = cifrar(JSON.stringify({ privada, integridad, eventos }), claveDePlataforma());
  } catch {
    return { ok: false, error: "Falta APP_ENCRYPTION_KEY o no es válida: sin ella no se pueden guardar secretos." };
  }

  await consultar(
    `insert into public.platform_settings (key, value, encrypted, updated_by, updated_at)
     values ('wompi', $1::jsonb, $2, $3, now())
     on conflict (key) do update
       set value = excluded.value, encrypted = excluded.encrypted, updated_by = excluded.updated_by, updated_at = now()`,
    [JSON.stringify({ publica: llaves.publica }), cifrado, actor.id],
  );
  await anotar(actor, "wompi.llaves", { ambiente: validadas.ambiente });
  olvidarAjustesRecordados();
  revalidatePath("/admin/cobro");
  return {
    ok: true,
    mensaje: `Llaves de ${validadas.ambiente === "produccion" ? "producción" : "pruebas"} guardadas y cifradas.`,
  };
}

/**
 * La clave de OpenRouter con la que hablan todos los modelos, de la web y del
 * worker. Se guarda cifrada y, a diferencia de las de Wompi, se comprueba
 * contra OpenRouter antes de guardarla: una clave mala dejaría mudos a todos
 * los agentes a la vez.
 */
export async function guardarClaveDeCartera(datos: FormData): Promise<ResultadoAdmin> {
  const actor = await superAdminActual();
  if (!actor) return NO_AUTORIZADO;

  const validada = validarClaveDeCartera(datos.get("openrouter"));
  if (!validada.ok) return { ok: false, error: validada.motivo };

  const respuesta = await comprobarClaveDeCartera(validada.clave);
  if (respuesta.estado === "rechaza") {
    return { ok: false, error: "OpenRouter no acepta esa clave. Revisa que esté vigente y copiada entera." };
  }

  let cifrado: string;
  try {
    cifrado = cifrar(JSON.stringify({ openrouter: validada.clave }), claveDePlataforma());
  } catch {
    return { ok: false, error: "Falta APP_ENCRYPTION_KEY o no es válida: sin ella no se pueden guardar secretos." };
  }

  await consultar(
    `insert into public.platform_settings (key, value, encrypted, updated_by, updated_at)
     values ('modelos', '{}'::jsonb, $1, $2, now())
     on conflict (key) do update
       set encrypted = excluded.encrypted, updated_by = excluded.updated_by, updated_at = now()`,
    [cifrado, actor.id],
  );
  await anotar(actor, "modelos.clave", { comprobada: respuesta.estado === "acepta" });
  olvidarAjustesRecordados();
  revalidatePath("/admin/cobro");
  return {
    ok: true,
    mensaje:
      respuesta.estado === "acepta"
        ? "Clave guardada y cifrada. OpenRouter la acepta; el worker la toma en menos de un minuto."
        : "Clave guardada y cifrada. OpenRouter no respondió ahora mismo, así que no se pudo comprobar.",
  };
}

/** Vuelve a la clave del entorno (o al modo de ensayo si no hay ninguna). */
export async function olvidarClaveDeCartera(): Promise<ResultadoAdmin> {
  const actor = await superAdminActual();
  if (!actor) return NO_AUTORIZADO;

  await consultar(`delete from public.platform_settings where key = 'modelos'`, []);
  await anotar(actor, "modelos.olvidar", {});
  olvidarAjustesRecordados();
  // La siguiente lectura devuelve al entorno la clave del `.env`, si había.
  await obtenerClaveDeCartera();
  revalidatePath("/admin/cobro");
  return { ok: true, mensaje: "Clave olvidada. Si el entorno tiene una, se usa esa; si no, los agentes entran en modo de ensayo." };
}

/**
 * Da o quita créditos a mano. Nunca cuenta como venta y siempre pide un motivo.
 *
 * `nonce` lo genera la página al pintarse: un doble clic o un reenvío del
 * formulario no aplica el ajuste dos veces.
 */
export async function ajustarCreditos(datos: FormData): Promise<ResultadoAdmin> {
  const actor = await superAdminActual();
  if (!actor) return NO_AUTORIZADO;

  const workspaceId = String(datos.get("workspaceId") ?? "");
  const nonce = String(datos.get("nonce") ?? "");
  const motivo = String(datos.get("motivo") ?? "").trim();
  const operacion = datos.get("operacion") === "quitar" ? "quitar" : "dar";
  const creditos = Number(datos.get("creditos"));

  if (!Number.isInteger(creditos) || creditos <= 0) {
    return { ok: false, error: "Escribe una cantidad de créditos, en número entero." };
  }
  if (motivo.length < 5) return { ok: false, error: "Escribe el motivo: quedará en el libro del cliente." };
  if (!nonce) return { ok: false, error: "Recarga la página e inténtalo de nuevo." };

  const clave = `admin:${nonce}`;
  const descripcion = `Ajuste manual: ${motivo}`;
  const metadatos = JSON.stringify({ actor: actor.correo, motivo });

  const resultado = await conEspacio(workspaceId, async (scope) => {
    // La clave se reclama solo cuando el ajuste va a aplicarse: si se reclamara
    // antes, corregir la cifra tras un «no tiene tantos créditos» respondería que
    // ya estaba aplicado sin haber hecho nada.
    const reclamar = async () => {
      const { rows } = await scope.query(
        `insert into public.credit_idempotency (workspace_id, idempotency_key)
         values ($1, $2) on conflict do nothing returning 1 as ok`,
        [workspaceId, clave],
      );
      return rows.length > 0;
    };

    if (operacion === "dar") {
      if (!(await reclamar())) return "repetido" as const;
      await scope.query(
        `select applied from public.grant_credits($1, $2, $3::numeric, 'purchased', 'admin_adjustment', $4, $5::jsonb)`,
        [workspaceId, clave, creditos, descripcion, metadatos],
      );
      return "hecho" as const;
    }

    const { rows } = await scope.query<{ included_balance: string; purchased_balance: string }>(
      `select included_balance, purchased_balance from public.credit_wallets where workspace_id = $1 for update`,
      [workspaceId],
    );
    const incluido = Number(rows[0]?.included_balance ?? 0);
    const comprado = Number(rows[0]?.purchased_balance ?? 0);
    const reparto = repartirDescuento(incluido, comprado, creditos);
    if (!reparto) return "insuficiente" as const;
    if (!(await reclamar())) return "repetido" as const;

    await scope.query(
      `insert into public.credit_ledger
         (workspace_id, direction, source, amount, from_included, from_purchased,
          balance_after, idempotency_key, description, metadata)
       values ($1, 'debit', 'admin_adjustment', $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [workspaceId, creditos, reparto.incluido, reparto.comprado, incluido + comprado - creditos, clave, descripcion, metadatos],
    );
    await scope.query(
      `update public.credit_wallets
          set included_balance = included_balance - $2,
              purchased_balance = purchased_balance - $3,
              updated_at = now()
        where workspace_id = $1`,
      [workspaceId, reparto.incluido, reparto.comprado],
    );
    return "hecho" as const;
  });

  if (resultado === "repetido") return { ok: true, mensaje: "Ese ajuste ya estaba aplicado." };
  if (resultado === "insuficiente") return { ok: false, error: "El cliente no tiene tantos créditos para quitar." };

  await anotar(actor, operacion === "dar" ? "creditos.dar" : "creditos.quitar", { creditos, motivo }, workspaceId);
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return { ok: true, mensaje: `${operacion === "dar" ? "Añadidos" : "Quitados"} ${creditos} créditos.` };
}

export async function cambiarEstadoCliente(datos: FormData): Promise<ResultadoAdmin> {
  const actor = await superAdminActual();
  if (!actor) return NO_AUTORIZADO;

  const workspaceId = String(datos.get("workspaceId") ?? "");
  const motivo = String(datos.get("motivo") ?? "").trim();
  const suspender = datos.get("operacion") === "suspender";
  if (suspender && motivo.length < 5) return { ok: false, error: "Escribe el motivo de la suspensión." };

  const filas = await consultar<{ id: string }>(
    `update public.workspaces set status = $2, updated_at = now()
      where id = $1 and status = $3 returning id`,
    [workspaceId, suspender ? "suspended" : "active", suspender ? "active" : "suspended"],
  );
  if (filas.length === 0) return { ok: false, error: "Este cliente ya no está en ese estado." };

  await anotar(actor, suspender ? "cliente.suspender" : "cliente.reactivar", { motivo }, workspaceId);
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {
    ok: true,
    mensaje: suspender
      ? "Cuenta suspendida. Sus agentes dejan de trabajar y sus usuarios ya no pueden entrar."
      : "Cuenta reactivada.",
  };
}

