import { redirect } from "next/navigation";

/**
 * Canales se mudó a Ajustes. Esta ruta queda solo para que los enlaces viejos
 * —correos, marcadores, la ficha de un agente abierta desde antes— sigan
 * llegando a su sitio en vez de a un 404.
 */
export default function Pagina() {
  redirect("/ajustes/canales");
}
