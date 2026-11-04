/**
 * Arranca una recarga: cotiza, guarda la orden y devuelve la URL de pago.
 *
 * El importe se decide aquí y queda en la orden. Lo que llegue después en el
 * evento solo puede confirmar esa cifra, nunca cambiarla.
 */
import { cotizar, obtenerTrm, validarMonto } from "@strappy/core/recargas";
import { urlDeCheckout } from "@strappy/core/wompi";
import { exigirUsuarioActual } from "@/lib/identidad";
import { crearOrdenDeRecarga } from "@/lib/negocio/facturacion";
import { obtenerConfigCobro, obtenerLlavesWompi } from "@/lib/plataforma/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const usuario = await exigirUsuarioActual();
  if (usuario.rol !== "owner" && usuario.rol !== "admin") {
    return Response.json({ error: "Solo el propietario o un administrador pueden recargar." }, { status: 403 });
  }

  const [llaves, config] = await Promise.all([obtenerLlavesWompi(), obtenerConfigCobro()]);
  const llavePublica = llaves.publica;
  const secretoIntegridad = llaves.integridad;
  if (!llavePublica || !secretoIntegridad) {
    return Response.json({ error: "Los pagos aún no están configurados en esta instalación." }, { status: 503 });
  }

  const cuerpo = (await peticion.json().catch(() => ({}))) as { usd?: unknown };
  const monto = validarMonto(cuerpo.usd, config);
  if (!monto.ok) return Response.json({ error: monto.motivo }, { status: 400 });

  const trm = await obtenerTrm();
  if (trm === null) {
    return Response.json(
      { error: "No pudimos consultar la TRM del día para calcular el valor en pesos. Inténtalo en unos minutos." },
      { status: 503 },
    );
  }

  const cotizacion = cotizar(monto.usd, trm);
  const { referencia } = await crearOrdenDeRecarga({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    cotizacion,
  });

  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
  return Response.json({
    url: urlDeCheckout({
      llavePublica,
      secretoIntegridad,
      referencia,
      centavos: cotizacion.centavos,
      urlDeRetorno: `${base}/ajustes/facturacion?resultado=procesando`,
      correo: usuario.correo,
      // La cotización vale una hora: una pestaña abierta días no paga con una TRM vieja.
      expiracion: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
}
