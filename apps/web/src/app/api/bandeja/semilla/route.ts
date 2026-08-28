/**
 * Siembra conversaciones de ejemplo. Solo en desarrollo.
 *
 * La puerta es la misma que abre la sesión de desarrollo: si hay autenticación
 * real configurada, esta ruta no existe. Sembrar datos falsos en el espacio de
 * un cliente sería peor que no poder probar.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { sembrarBandeja } from "@/lib/bandeja/semilla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const usuario = await exigirUsuarioActual();
  if (!usuario.esDesarrollo) {
    return Response.json({ error: "Solo disponible en desarrollo." }, { status: 404 });
  }
  const resultado = await sembrarBandeja({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
  });
  return Response.json(resultado);
}
