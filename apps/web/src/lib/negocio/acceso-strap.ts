import "server-only";

/**
 * Hablar con Strap exige tener créditos.
 *
 * Se comprueba en el servidor, en cada ruta que abre o continúa una conversación:
 * lo que pinta la pantalla es solo una cortesía. Si la consulta falla, la ruta
 * responde con error y no deja pasar. Leer lo ya conversado sigue abierto.
 */
import { conEspacio } from "@/lib/db/pool";
import { CODIGO_SIN_CREDITOS, puedeHablarConStrap } from "./creditos";

/** El mismo saldo que usa el motor: descuenta lo reservado y un espacio suspendido da cero. */
export async function tieneCreditosParaStrap(workspaceId: string): Promise<boolean> {
  const { rows } = await conEspacio(workspaceId, (scope) =>
    scope.query<{ disponible: string }>(
      `select c.included_balance + c.purchased_balance - c.reserved_balance as disponible
         from public.credit_wallets c
         join public.workspaces w on w.id = c.workspace_id
        where c.workspace_id = $1 and w.status = 'active'`,
      [workspaceId],
    ),
  );
  return puedeHablarConStrap(Number(rows[0]?.disponible ?? 0));
}

export function respuestaSinCreditos(): Response {
  return Response.json(
    { error: "Para hablar con Strap necesitas créditos.", codigo: CODIGO_SIN_CREDITOS },
    { status: 402 },
  );
}
