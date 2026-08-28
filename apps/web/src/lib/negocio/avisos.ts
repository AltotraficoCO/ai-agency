import "server-only";

/**
 * Avisos de saldo: 80% y 100%.
 *
 * Un aviso solo sirve si llega UNA vez. Si el banner del 80% mandara un correo
 * en cada visita a la aplicación, el cliente lo filtraría el segundo día y no
 * leería el del 100%, que es el que importa. Por eso cada aviso se reclama en
 * `credit_idempotency` con una clave que incluye el periodo: uno por umbral y
 * por periodo, y la renovación vuelve a habilitarlos sola.
 *
 * El envío es opcional a propósito. Sin `RESEND_API_KEY` el aviso igualmente
 * queda anotado en la bitácora: el banner de la interfaz no depende del correo,
 * y una instalación sin proveedor de correo no debe romperse por esto.
 */
import { conEspacio } from "@/lib/db/pool";
import { creditosCompactos, fraseDeProyeccion, type Proyeccion } from "./creditos";

export type Umbral = "80" | "100";

export async function avisarSiHaceFalta(entrada: {
  workspaceId: string;
  correo: string;
  nombreEspacio: string;
  proyeccion: Proyeccion;
  inicioPeriodo: Date;
}): Promise<Umbral | null> {
  const fraccion = entrada.proyeccion.porcentajeActual;
  const umbral: Umbral | null = fraccion >= 1 ? "100" : fraccion >= 0.8 ? "80" : null;
  if (!umbral) return null;

  const periodo = entrada.inicioPeriodo.toISOString().slice(0, 10);
  const clave = `aviso:${umbral}:${periodo}`;

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
        umbral === "100" ? "creditos.agotados" : "creditos.aviso_80",
        JSON.stringify({
          consumidos: entrada.proyeccion.consumidos,
          asignados: entrada.proyeccion.asignados,
          proyectado: entrada.proyeccion.proyectado,
        }),
      ],
    );
    return true;
  });

  if (!nuevo) return null;

  await enviarCorreo({
    para: entrada.correo,
    asunto:
      umbral === "100"
        ? `Te quedaste sin créditos en ${entrada.nombreEspacio}`
        : `Llevas el 80% de tus créditos en ${entrada.nombreEspacio}`,
    cuerpo: cuerpoDelAviso(umbral, entrada.proyeccion),
  });

  return umbral;
}

/** El texto del correo. Dice lo mismo que el banner, palabra por palabra. */
export function cuerpoDelAviso(umbral: Umbral, proyeccion: Proyeccion): string {
  if (umbral === "100") {
    return [
      "Te quedaste sin créditos.",
      "",
      "Tu agente dejó de responder automáticamente. Tu bandeja, tus contactos y tu historial siguen funcionando con normalidad: tu equipo puede seguir contestando a mano mientras tanto.",
      "",
      "Recarga desde Ajustes → Facturación y el agente vuelve a responder al instante. Los créditos que compres no caducan.",
    ].join("\n");
  }
  return [
    `Llevas ${creditosCompactos(proyeccion.consumidos)} de ${creditosCompactos(
      proyeccion.asignados,
    )} créditos usados este periodo.`,
    "",
    fraseDeProyeccion(proyeccion),
    "",
    "Si llegas al 100%, el agente deja de responder solo; tu bandeja sigue funcionando. Puedes recargar o cambiar de plan desde Ajustes → Facturación.",
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
