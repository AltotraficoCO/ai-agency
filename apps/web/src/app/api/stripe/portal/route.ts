/**
 * Portal del cliente de Stripe: método de pago, facturas y cancelación.
 *
 * No reimplementamos ninguna de esas tres pantallas. Stripe las mantiene al
 * día con los requisitos legales de cada país, y una copia nuestra estaría
 * desactualizada el primer trimestre.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { clienteStripeDelEspacio } from "@/lib/negocio/facturacion";
import { sesionDePortal } from "@/lib/negocio/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const usuario = await exigirUsuarioActual();
  if (usuario.rol !== "owner" && usuario.rol !== "admin") {
    return Response.json(
      { error: "Solo el propietario o un administrador pueden abrir el portal de facturación." },
      { status: 403 },
    );
  }

  const cliente = await clienteStripeDelEspacio(usuario.workspaceId);
  const resultado = await sesionDePortal(cliente);
  if (!resultado.ok) return Response.json({ error: resultado.motivo }, { status: 503 });
  return Response.json({ url: resultado.url });
}
