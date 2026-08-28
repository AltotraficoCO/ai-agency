/**
 * El inicio de Strappy.
 *
 * Es el chat con Strap, no un panel. Todo lo que se lee aquí —quién eres, qué
 * conversaciones tienes abiertas— se resuelve en el servidor; la pantalla no
 * hace ni una consulta al montar.
 */
import { MarcoApp } from "@/components/marco-app";
import { Inicio } from "@/components/meta/inicio";
import { datosDelMarco } from "@/lib/marco";
import { listarHilos } from "@/lib/meta/borradores";

export const dynamic = "force-dynamic";

export default async function PaginaInicio() {
  const marco = await datosDelMarco();
  const hilos = await listarHilos(marco.actual.workspaceId);

  // Max se ofrece cuando el plan lo incluye. Hasta que exista la comprobación
  // real contra `subscriptions`, la puerta se abre sola en desarrollo y queda
  // con candado en cualquier despliegue: equivocarse hacia el candado es
  // gratis, equivocarse hacia el modelo caro lo paga la casa.
  const maxDisponible = marco.actual.esDesarrollo;

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Inicio"
    >
      <Inicio
        nombre={primerNombre(marco.actual.nombre)}
        hilos={hilos}
        maxDisponible={maxDisponible}
      />
    </MarcoApp>
  );
}

function primerNombre(completo: string): string {
  return completo.trim().split(/\s+/)[0] ?? completo;
}
