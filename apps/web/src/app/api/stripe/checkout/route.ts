/**
 * Arranca un pago: cambio de plan o recarga de créditos.
 *
 * Devuelve JSON con la URL en vez de redirigir, para que la interfaz pueda
 * explicar en el sitio por qué no hay pago posible cuando Stripe no está
 * configurado, en lugar de mandar al cliente a una página en blanco.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { clienteStripeDelEspacio } from "@/lib/negocio/facturacion";
import { planPorClave, recargaPorClave } from "@/lib/negocio/planes";
import { sesionDeRecarga, sesionDeSuscripcion } from "@/lib/negocio/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cuerpo = { plan?: string; recarga?: string };

export async function POST(peticion: Request) {
  const usuario = await exigirUsuarioActual();

  // Cambiar de plan o comprar créditos es facturación: solo quien manda.
  if (usuario.rol !== "owner" && usuario.rol !== "admin") {
    return Response.json(
      { error: "Solo el propietario o un administrador pueden cambiar el plan." },
      { status: 403 },
    );
  }

  const cuerpo = (await peticion.json().catch(() => ({}))) as Cuerpo;
  const clientePrevio = await clienteStripeDelEspacio(usuario.workspaceId);

  if (cuerpo.recarga) {
    const recarga = recargaPorClave(cuerpo.recarga);
    if (!recarga) return Response.json({ error: "Ese paquete no existe." }, { status: 400 });
    const resultado = await sesionDeRecarga({
      workspaceId: usuario.workspaceId,
      correo: usuario.correo,
      precioEnv: recarga.precioStripeEnv,
      creditos: recarga.creditos,
      clientePrevio,
    });
    return respuesta(resultado);
  }

  const plan = planPorClave(cuerpo.plan);
  if (plan.precioUsd === 0) {
    return Response.json(
      { error: "El plan Free no se cobra: se activa desde el portal o al cancelar el plan actual." },
      { status: 400 },
    );
  }

  const resultado = await sesionDeSuscripcion({
    workspaceId: usuario.workspaceId,
    correo: usuario.correo,
    precioEnv: plan.precioStripeEnv,
    clientePrevio,
  });
  return respuesta(resultado);
}

function respuesta(resultado: { ok: true; url: string } | { ok: false; motivo: string }) {
  if (!resultado.ok) return Response.json({ error: resultado.motivo }, { status: 503 });
  return Response.json({ url: resultado.url });
}
