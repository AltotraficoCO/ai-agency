import "server-only";

/**
 * Equipo del espacio: quién está dentro y quién está invitado.
 *
 * TRES PAPELES, y son tres porque son las tres preguntas reales que se hace
 * quien monta un equipo de atención:
 *   · Administrador — puede tocarlo todo, incluida la factura.
 *   · Atención      — vive en la bandeja: contesta, pero no cambia agentes ni
 *                     plan.
 *   · Analista      — solo mira los números. Ni contesta ni configura.
 *
 * El propietario existe pero no se asigna: lo es quien creó el espacio, y no se
 * puede degradar desde aquí para que un espacio no se quede sin nadie que pueda
 * pagar la factura.
 */
import { consultar } from "@/lib/db/pool";

export const PAPELES = [
  {
    clave: "admin",
    nombre: "Administrador",
    descripcion: "Puede configurar agentes, canales, equipo y facturación.",
  },
  {
    clave: "agent",
    nombre: "Atención",
    descripcion: "Trabaja en la bandeja: contesta y escala. No toca la configuración.",
  },
  {
    clave: "analyst",
    nombre: "Analista",
    descripcion: "Solo lectura de analítica y consumo.",
  },
] as const;

export const NOMBRE_PAPEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  builder: "Constructor",
  agent: "Atención",
  analyst: "Analista",
};

export type Miembro = {
  readonly id: string;
  readonly usuarioId: string;
  readonly nombre: string;
  readonly correo: string;
  readonly rol: string;
  readonly estado: string;
  readonly desde: string;
};

export type Invitacion = {
  readonly id: string;
  readonly correo: string;
  readonly rol: string;
  readonly expira: string;
};

export async function equipoDelEspacio(workspaceId: string): Promise<{
  miembros: Miembro[];
  invitaciones: Invitacion[];
}> {
  // Va por la conexión transversal y no por `conEspacio` porque necesita
  // `auth.users` para el correo, y el rol acotado del worker no tiene acceso a
  // ese esquema. El `workspace_id` sale SIEMPRE de la sesión, nunca del cliente.
  const [miembros, invitaciones] = await Promise.all([
    consultar<{
      id: string;
      user_id: string;
      nombre: string | null;
      correo: string | null;
      role: string;
      status: string;
      created_at: string;
    }>(
        `select m.id, m.user_id, p.full_name as nombre, u.email as correo,
                m.role, m.status, m.created_at
           from public.memberships m
           left join public.profiles p on p.user_id = m.user_id
           left join auth.users u on u.id = m.user_id
          where m.workspace_id = $1
          order by (m.role = 'owner') desc, m.created_at asc`,
        [workspaceId],
      ),
    consultar<{ id: string; email: string; role: string; expires_at: string }>(
        `select id, email, role, expires_at
           from public.invitations
          where workspace_id = $1 and accepted_at is null and revoked_at is null
          order by created_at desc`,
        [workspaceId],
      ),
  ]);

  return {
    miembros: miembros.map((f) => ({
      id: f.id,
      usuarioId: f.user_id,
      nombre: f.nombre ?? "Sin nombre",
      correo: f.correo ?? "",
      rol: f.role,
      estado: f.status,
      desde: f.created_at,
    })),
    invitaciones: invitaciones.map((f) => ({
      id: f.id,
      correo: f.email,
      rol: f.role,
      expira: f.expires_at,
    })),
  };
}

/** Horario de atención guardado en `workspaces.settings`. */
export type HorarioAtencion = {
  readonly dias: readonly string[];
  readonly desde: string;
  readonly hasta: string;
  readonly fueraDeHorario: string;
};

export const DIAS_SEMANA = [
  { clave: "lun", nombre: "Lunes" },
  { clave: "mar", nombre: "Martes" },
  { clave: "mie", nombre: "Miércoles" },
  { clave: "jue", nombre: "Jueves" },
  { clave: "vie", nombre: "Viernes" },
  { clave: "sab", nombre: "Sábado" },
  { clave: "dom", nombre: "Domingo" },
] as const;

export function horarioDesdeAjustes(settings: Record<string, unknown>): HorarioAtencion {
  const nodo = (settings["horario_atencion"] ?? {}) as Record<string, unknown>;
  return {
    dias: Array.isArray(nodo["dias"]) ? (nodo["dias"] as string[]) : ["lun", "mar", "mie", "jue", "vie"],
    desde: typeof nodo["desde"] === "string" ? nodo["desde"] : "09:00",
    hasta: typeof nodo["hasta"] === "string" ? nodo["hasta"] : "18:00",
    fueraDeHorario: typeof nodo["fuera_de_horario"] === "string" ? nodo["fuera_de_horario"] : "",
  };
}
