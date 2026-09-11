/**
 * Los agentes de WhatsApp: los que contestan a los clientes. Los crea Strap
 * desde Inicio, o se contrata la Recepcionista del catálogo.
 */
import { ListaAgentes } from "@/components/agentes/lista-agentes";

export const metadata = { title: "Agentes de WhatsApp" };
export const dynamic = "force-dynamic";

export default function PaginaAgentesDeWhatsapp() {
  return <ListaAgentes clase="whatsapp" />;
}
