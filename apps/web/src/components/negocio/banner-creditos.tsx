import { EnlaceBoton } from "@/components/enlace-boton";
import { creditosCompactos, fraseDeProyeccion, type Proyeccion } from "@/lib/negocio/creditos";
import type { EstadoSaldo } from "@/lib/negocio/creditos";

/**
 * El aviso de saldo.
 *
 * Ámbar al 80% y rojo al 100%. El texto del rojo dice lo que de verdad pasa y
 * lo dice en la primera frase: EL AGENTE DEJÓ DE RESPONDER, LA BANDEJA SIGUE
 * ABIERTA. Un banner que solo dijera «te quedaste sin créditos» haría creer que
 * la cuenta está bloqueada, y el cliente perdería una mañana de atención
 * pensando que no puede escribir a nadie.
 */
export function BannerCreditos({
  estado,
  proyeccion,
}: {
  estado: EstadoSaldo;
  proyeccion: Proyeccion;
}) {
  if (estado === "sano") return null;

  const agotado = estado === "agotado";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
        agotado
          ? "border-danger/40 bg-danger-soft text-danger-fg"
          : "border-warning/40 bg-warning-soft text-warning-fg"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {agotado
            ? "Te quedaste sin créditos: el agente dejó de responder solo."
            : `Llevas ${creditosCompactos(proyeccion.consumidos)} de ${creditosCompactos(
                proyeccion.asignados,
              )} créditos de este periodo.`}
        </p>
        <p className="text-sm opacity-90">
          {agotado
            ? "Tu bandeja, tus contactos y tu historial siguen funcionando: tu equipo puede seguir contestando a mano. En cuanto recargues, el agente vuelve a responder."
            : fraseDeProyeccion(proyeccion)}
        </p>
      </div>
      <EnlaceBoton href="/ajustes/facturacion" variant={agotado ? "primary" : "secondary"} size="sm">
        {agotado ? "Recargar créditos" : "Ver mi consumo"}
      </EnlaceBoton>
    </div>
  );
}
