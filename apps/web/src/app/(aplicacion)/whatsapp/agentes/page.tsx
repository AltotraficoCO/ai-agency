/**
 * Los agentes de WhatsApp: los que contestan a los clientes. No se contratan:
 * los crea la persona con Strap desde Inicio.
 */
import { ListaAgentes } from "@/components/agentes/lista-agentes";

export const metadata = { title: "Agentes de WhatsApp" };
export const dynamic = "force-dynamic";

export default function PaginaAgentesDeWhatsapp() {
  return <ListaAgentes clase="whatsapp" />;
}
