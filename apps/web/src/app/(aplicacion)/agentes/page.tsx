/**
 * Tu equipo: todos los agentes que trabajan para la empresa, por departamento.
 * Los que atienden por WhatsApp viven en `/whatsapp/agentes`.
 */
import { ListaAgentes } from "@/components/agentes/lista-agentes";

export const metadata = { title: "Tu equipo" };
export const dynamic = "force-dynamic";

export default function PaginaEquipo() {
  return <ListaAgentes clase="negocio" />;
}
