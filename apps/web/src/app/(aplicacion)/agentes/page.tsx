/**
 * Los agentes del negocio: los que trabajan por encargo para la empresa
 * (Webmaster, Marketing). Los que atienden por WhatsApp viven en
 * `/whatsapp/agentes`.
 */
import { ListaAgentes } from "@/components/agentes/lista-agentes";

export const metadata = { title: "Agentes del negocio" };
export const dynamic = "force-dynamic";

export default function PaginaAgentesDelNegocio() {
  return <ListaAgentes clase="negocio" />;
}
