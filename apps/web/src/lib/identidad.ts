/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL ÚNICO SITIO DE LA APLICACIÓN QUE SABE QUIÉN ES EL USUARIO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ningún otro archivo debe importar `@supabase/ssr`, `@supabase/supabase-js`
 * ni ningún otro SDK de identidad para averiguar quién está usando la
 * aplicación. Todo pasa por `obtenerUsuarioActual()`.
 *
 * NO ES UNA REGLA DE ESTILO. La razón es concreta: hoy la identidad es Supabase
 * Auth porque el aislamiento entre clientes está construido sobre `auth.uid()`
 * en las 47 tablas y verificado por `packages/db/tests/isolation.sql`. El día
 * que entre un cliente que exija SSO con SAML —y va a entrar— habrá que mover
 * la identidad a otro proveedor (Clerk, WorkOS, lo que sea). Si ese día la
 * llamada al SDK está esparcida por cincuenta componentes, la migración es un
 * trimestre. Si está aquí, es este archivo.
 *
 * Las excepciones legítimas, y no hay más:
 *   · `lib/supabase/*` — construye los clientes.
 *   · `middleware.ts` — refresca la cookie de sesión en cada petición.
 *   · `app/(acceso)/**` — los formularios de entrar, registrarse y recuperar.
 *   · `app/auth/**` — el retorno del OAuth y el cierre de sesión.
 *
 * Todo lo demás llama a `obtenerUsuarioActual()` y no sabe qué hay detrás.
 */
import { crearClienteServidor, hayAutenticacionConfigurada } from "./supabase/servidor";
import { consultar } from "./db/pool";

export type UsuarioActual = {
  readonly id: string;
  readonly correo: string;
  readonly nombre: string;
  readonly avatarUrl?: string;
  /** Espacio de trabajo activo. Es la frontera de aislamiento entre clientes. */
  readonly workspaceId: string;
  readonly workspaceNombre: string;
  readonly rol: string;
  /** true cuando la sesión viene del atajo de desarrollo, no de un inicio real. */
  readonly esDesarrollo: boolean;
};

/**
 * Quién está usando la aplicación, o `null` si nadie.
 *
 * Cuando no hay Supabase configurado (desarrollo sin la pila de Supabase
 * levantada) devuelve el usuario sembrado por `pnpm --filter @strappy/db seed`.
 * Es un atajo DE DESARROLLO: se apaga solo en cuanto existe
 * `NEXT_PUBLIC_SUPABASE_URL`, y en producción esa variable existe siempre.
 */
export async function obtenerUsuarioActual(): Promise<UsuarioActual | null> {
  if (!hayAutenticacionConfigurada()) return usuarioDeDesarrollo();

  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const espacio = await espacioPorDefecto(user.id);
  if (!espacio) return null;

  const metadatos = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nombre =
    texto(metadatos["full_name"]) ||
    texto(metadatos["name"]) ||
    (user.email ?? "").split("@")[0] ||
    "Sin nombre";

  return {
    id: user.id,
    correo: user.email ?? "",
    nombre,
    ...(texto(metadatos["avatar_url"]) ? { avatarUrl: texto(metadatos["avatar_url"]) } : {}),
    workspaceId: espacio.workspace_id,
    workspaceNombre: espacio.workspace_nombre,
    rol: espacio.rol,
    esDesarrollo: false,
  };
}

/** Igual que la anterior, pero falla si no hay nadie. Para rutas ya protegidas. */
export async function exigirUsuarioActual(): Promise<UsuarioActual> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) throw new Error("No hay ninguna sesión iniciada.");
  return usuario;
}

type FilaEspacio = { workspace_id: string; workspace_nombre: string; rol: string };

async function espacioPorDefecto(userId: string): Promise<FilaEspacio | null> {
  const filas = await consultar<FilaEspacio>(
    `select w.id as workspace_id, w.name as workspace_nombre, m.role as rol
       from public.memberships m
       join public.workspaces w on w.id = m.workspace_id
       left join public.profiles p on p.user_id = m.user_id
      where m.user_id = $1 and m.status = 'active' and w.status = 'active'
      order by (w.id = p.default_workspace_id) desc, m.created_at asc
      limit 1`,
    [userId],
  );
  return filas[0] ?? null;
}

async function usuarioDeDesarrollo(): Promise<UsuarioActual | null> {
  const correo = process.env.STRAPPY_USUARIO_DEV ?? "demo@strappy.test";
  const filas = await consultar<
    FilaEspacio & { user_id: string; nombre: string | null; correo: string }
  >(
    `select m.user_id, w.id as workspace_id, w.name as workspace_nombre, m.role as rol,
            p.full_name as nombre, u.email as correo
       from public.memberships m
       join public.workspaces w on w.id = m.workspace_id
       join auth.users u on u.id = m.user_id
       left join public.profiles p on p.user_id = m.user_id
      where u.email = $1 and m.status = 'active'
      limit 1`,
    [correo],
  );
  const fila = filas[0];
  if (!fila) return null;
  return {
    id: fila.user_id,
    correo: fila.correo,
    nombre: fila.nombre ?? "Cuenta de desarrollo",
    workspaceId: fila.workspace_id,
    workspaceNombre: fila.workspace_nombre,
    rol: fila.rol,
    esDesarrollo: true,
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}
