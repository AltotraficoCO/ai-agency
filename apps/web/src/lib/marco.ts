import "server-only";

/**
 * Datos que necesita el armazón en cada página: quién eres y cuánto te queda.
 * Se lee una vez por navegación; son dos consultas por clave primaria.
 */
import { exigirUsuarioActual, type UsuarioActual } from "./identidad";
import { conEspacio } from "./db/pool";

export type DatosMarco = {
  usuario: { nombre: string; correo: string; avatar?: string };
  creditos: { consumidos: number; total: number; renovacion: string };
  pendientes: number;
  actual: UsuarioActual;
};

export async function datosDelMarco(): Promise<DatosMarco> {
  const actual = await exigirUsuarioActual();

  const { cartera, pendientes } = await conEspacio(actual.workspaceId, async (scope) => {
    // Una detrás de otra: `scope` es UNA conexión dentro de una transacción, y
    // lanzarle dos consultas a la vez no las paraleliza (pg las encola) y además
    // está deprecado. Esto corre en el layout, o sea en cada pantalla.
    const monedero = await scope.query<{
      included_balance: string;
      purchased_balance: string;
      included_granted: string;
      period_end: string;
    }>(
      `select included_balance, purchased_balance, included_granted, period_end
         from public.credit_wallets where workspace_id = $1`,
      [scope.workspaceId],
    );
    const bandeja = await scope.query<{ n: string }>(
      `select count(*) as n from public.conversations
        where workspace_id = $1 and status = 'open' and unread_count > 0`,
      [scope.workspaceId],
    );
    return { cartera: monedero.rows[0], pendientes: Number(bandeja.rows[0]?.n ?? 0) };
  });

  const otorgados = Number(cartera?.included_granted ?? 0);
  const disponibles = Number(cartera?.included_balance ?? 0) + Number(cartera?.purchased_balance ?? 0);

  return {
    actual,
    usuario: {
      nombre: actual.nombre,
      correo: actual.correo,
      ...(actual.avatarUrl ? { avatar: actual.avatarUrl } : {}),
    },
    creditos: {
      consumidos: Math.max(0, Math.round(otorgados - disponibles)),
      total: Math.max(1, Math.round(otorgados)),
      renovacion: formatearFecha(cartera?.period_end),
    },
    pendientes,
  };
}

const FORMATO = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long" });

function formatearFecha(valor: string | undefined): string {
  if (!valor) return "sin fecha";
  return FORMATO.format(new Date(valor));
}
