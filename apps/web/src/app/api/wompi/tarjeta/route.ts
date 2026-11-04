/**
 * Registra la tarjeta para la recarga automática.
 *
 * El navegador solo entrega el token del widget de Wompi y los dos contratos que
 * el cliente aceptó. El número de la tarjeta nunca pasa por Strappy.
 */
import { crearFuenteDePago } from "@strappy/core/wompi";
import { exigirUsuarioActual } from "@/lib/identidad";
import { guardarTarjeta } from "@/lib/negocio/facturacion";
import { obtenerLlavesWompi } from "@/lib/plataforma/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cuerpo = { token?: unknown; aceptacion?: unknown; datosPersonales?: unknown };

export async function POST(peticion: Request) {
  const usuario = await exigirUsuarioActual();
  if (usuario.rol !== "owner" && usuario.rol !== "admin") {
    return Response.json({ error: "Solo el propietario o un administrador pueden registrar una tarjeta." }, { status: 403 });
  }

  const { privada: llavePrivada } = await obtenerLlavesWompi();
  if (!llavePrivada) {
    return Response.json({ error: "Los pagos aún no están configurados en esta instalación." }, { status: 503 });
  }

  const { token, aceptacion, datosPersonales } = (await peticion.json().catch(() => ({}))) as Cuerpo;
  if (typeof token !== "string" || typeof aceptacion !== "string" || typeof datosPersonales !== "string") {
    return Response.json({ error: "Faltan datos de la tarjeta o la aceptación de los contratos." }, { status: 400 });
  }

  const fuente = await crearFuenteDePago({
    llavePrivada,
    token,
    correo: usuario.correo,
    aceptacion,
    datosPersonales,
  });
  if (!fuente.ok) return Response.json({ error: fuente.motivo }, { status: 400 });

  await guardarTarjeta({
    workspaceId: usuario.workspaceId,
    fuenteDePago: fuente.id,
    etiqueta: fuente.etiqueta,
    correo: usuario.correo,
  });
  return Response.json({ ok: true, tarjeta: fuente.etiqueta });
}
