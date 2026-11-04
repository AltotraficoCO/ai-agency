import "server-only";

/**
 * Avisos de saldo: poco saldo y saldo agotado.
 *
 * Un aviso solo sirve si llega UNA vez. Si el banner mandara un correo en cada
 * visita a la aplicación, el cliente lo filtraría el segundo día y no leería el
 * de saldo agotado, que es el que importa. Por eso cada aviso se reclama en
 * `credit_idempotency` con una clave que incluye la última recarga: uno por
 * umbral y por recarga, y la siguiente recarga vuelve a habilitarlos sola.
 *
 * El envío es opcional a propósito. Sin `RESEND_API_KEY` el aviso igualmente
 * queda anotado en la bitácora: el banner de la interfaz no depende del correo,
 * y una instalación sin proveedor de correo no debe romperse por esto.
 */
import { conEspacio } from "@/lib/db/pool";
import { creditosCompactos, type EstadoSaldo } from "./creditos";

export type Umbral = "poco" | "agotado";

export async function avisarSiHaceFalta(entrada: {
  workspaceId: string;
  correo: string;
  nombreEspacio: string;
  estado: EstadoSaldo;
  disponible: number;
  /** Fecha de la última recarga: cada recarga abre un ciclo de avisos nuevo. */
  ciclo: string;
}): Promise<Umbral | null> {
  // `sin_recargar` no avisa: nadie quiere un correo de «te quedaste sin créditos»
  // el día que se registra.
  const umbral: Umbral | null =
    entrada.estado === "agotado" ? "agotado" : entrada.estado === "aviso" ? "poco" : null;
  if (!umbral) return null;

  const clave = `aviso:${umbral}:${entrada.ciclo}`;

  const nuevo = await conEspacio(entrada.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ ok: boolean }>(
      `insert into public.credit_idempotency (workspace_id, idempotency_key)
       values ($1, $2)
       on conflict (workspace_id, idempotency_key) do nothing
       returning true as ok`,
      [entrada.workspaceId, clave],
    );
    if (rows.length === 0) return false;

    await scope.query(
      `insert into public.audit_log (workspace_id, actor_type, action, entity_type, after)
       values ($1, 'system', $2, 'credit_wallet', $3::jsonb)`,
      [
        entrada.workspaceId,
        umbral === "agotado" ? "creditos.agotados" : "creditos.saldo_bajo",
        JSON.stringify({ disponible: entrada.disponible }),
      ],
    );
    return true;
  });

  if (!nuevo) return null;

  await enviarCorreo({
    para: entrada.correo,
    asunto:
      umbral === "agotado"
        ? `Te quedaste sin créditos en ${entrada.nombreEspacio}`
        : `Te quedan pocos créditos en ${entrada.nombreEspacio}`,
    cuerpo: cuerpoDelAviso(umbral, entrada.disponible),
  });

  return umbral;
}

/** El texto del correo. Dice lo mismo que el banner. */
export function cuerpoDelAviso(umbral: Umbral, disponible: number): string {
  if (umbral === "agotado") {
    return [
      "Te quedaste sin créditos.",
      "",
      "Tu agente dejó de responder automáticamente. Tu bandeja, tus contactos y tu historial siguen funcionando con normalidad: tu equipo puede seguir contestando a mano mientras tanto.",
      "",
      "Recarga desde Ajustes → Facturación y el agente vuelve a responder en cuanto se confirme el pago. Los créditos que compres no caducan.",
    ].join("\n");
  }
  return [
    `Te quedan ${creditosCompactos(disponible)} créditos.`,
    "",
    "Si llegas a cero, el agente deja de responder solo; tu bandeja sigue funcionando. Puedes recargar desde Ajustes → Facturación.",
  ].join("\n");
}

/**
 * Envío por Resend si hay clave; si no, se deja constancia en el registro del
 * servidor. Nunca lanza: un fallo de correo no puede tumbar una página.
 */
async function enviarCorreo(mensaje: { para: string; asunto: string; cuerpo: string }): Promise<void> {
  const clave = process.env["RESEND_API_KEY"];
  const remitente = process.env["STRAPPY_CORREO_REMITENTE"] ?? "avisos@strappy.app";
  if (!clave) {
    console.info("[avisos] sin RESEND_API_KEY; no se envía:", mensaje.asunto, "→", mensaje.para);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: remitente,
        to: [mensaje.para],
        subject: mensaje.asunto,
        text: mensaje.cuerpo,
      }),
    });
  } catch (error) {
    console.error("[avisos] no se pudo enviar el correo:", error);
  }
}
