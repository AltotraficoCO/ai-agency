import "server-only";

/**
 * Quién es super admin.
 *
 * La lista vive en `SUPERADMIN_EMAILS` y no en la base a propósito: nada de lo que
 * se haga dentro de la aplicación puede nombrar a un super admin.
 *
 * El correo tiene que estar CONFIRMADO. Sin esto, cualquiera que se registrara con
 * un correo de la lista antes que su dueño entraría al panel.
 */
import { notFound } from "next/navigation";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { consultar } from "@/lib/db/pool";
import { crearClienteServidor, hayAutenticacionConfigurada } from "@/lib/supabase/servidor";

export type SuperAdmin = { readonly id: string; readonly correo: string };

export function correoEsSuperAdmin(correo: string | null | undefined, lista = process.env["SUPERADMIN_EMAILS"]): boolean {
  if (!correo || !lista) return false;
  const buscado = correo.trim().toLowerCase();
  return lista
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .some((c) => c !== "" && c === buscado);
}

/** No depende de tener un espacio activo: tu propio espacio puede estar suspendido. */
export async function superAdminActual(): Promise<SuperAdmin | null> {
  if (!hayAutenticacionConfigurada()) {
    // Atajo de desarrollo: `obtenerUsuarioActual` ya lo corta en producción.
    const usuario = await obtenerUsuarioActual();
    return usuario && correoEsSuperAdmin(usuario.correo) ? { id: usuario.id, correo: usuario.correo } : null;
  }
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !user.email_confirmed_at || !correoEsSuperAdmin(user.email)) return null;
  return { id: user.id, correo: user.email };
}

/** Para las páginas: a quien no es super admin, el panel no le existe. */
export async function exigirSuperAdmin(): Promise<SuperAdmin> {
  const admin = await superAdminActual();
  if (!admin) notFound();
  return admin;
}

/** Hay sesión, pero sus únicos espacios están suspendidos. */
export async function cuentaSuspendida(): Promise<boolean> {
  if (!hayAutenticacionConfigurada()) return false;
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const filas = await consultar<{ activos: string; suspendidos: string }>(
    `select count(*) filter (where w.status = 'active') as activos,
            count(*) filter (where w.status = 'suspended') as suspendidos
       from public.memberships m
       join public.workspaces w on w.id = m.workspace_id
      where m.user_id = $1 and m.status = 'active'`,
    [user.id],
  );
  return Number(filas[0]?.activos ?? 0) === 0 && Number(filas[0]?.suspendidos ?? 0) > 0;
}
