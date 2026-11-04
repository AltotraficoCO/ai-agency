import { EnlaceBoton } from "@/components/enlace-boton";
import { creditosCompactos, type EstadoSaldo } from "@/lib/negocio/creditos";

/**
 * El aviso de saldo.
 *
 * El texto del rojo dice lo que de verdad pasa y lo dice en la primera frase: EL
 * AGENTE DEJÓ DE RESPONDER, LA BANDEJA SIGUE ABIERTA. Un banner que solo dijera
 * «te quedaste sin créditos» haría creer que la cuenta está bloqueada, y el
 * cliente perdería una mañana de atención pensando que no puede escribir a nadie.
 */
export function BannerCreditos({ estado, disponible }: { estado: EstadoSaldo; disponible: number }) {
  if (estado === "sano") return null;

  const agotado = estado === "agotado";
  const inicial = estado === "sin_recargar";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
        agotado
          ? "border-danger/40 bg-danger-soft text-danger-fg"
          : inicial
            ? "border-border bg-inset text-fg"
            : "border-warning/40 bg-warning-soft text-warning-fg"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {agotado
            ? "Te quedaste sin créditos: el agente dejó de responder solo."
            : inicial
              ? "Tus agentes trabajan con créditos, y todavía no tienes."
              : `Te quedan ${creditosCompactos(disponible)} créditos.`}
        </p>
        <p className="text-sm opacity-90">
          {agotado
            ? "Tu bandeja, tus contactos y tu historial siguen funcionando: tu equipo puede seguir contestando a mano. En cuanto se confirme tu recarga, el agente vuelve a responder."
            : inicial
              ? "Haz tu primera recarga para que empiecen a trabajar. Los créditos no caducan."
              : "Si llegas a cero, el agente deja de responder solo. Tu bandeja sigue funcionando."}
        </p>
      </div>
      <EnlaceBoton href="/ajustes/facturacion" variant={agotado || inicial ? "primary" : "secondary"} size="sm">
        Recargar créditos
      </EnlaceBoton>
    </div>
  );
}
