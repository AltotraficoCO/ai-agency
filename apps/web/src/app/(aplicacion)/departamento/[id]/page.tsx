/**
 * Los agentes de un departamento.
 *
 * Una sola ruta para todos: añadir un departamento al menú no tiene por qué
 * crear una carpeta más. Si el departamento no existe (o todavía no tiene
 * pantalla propia, como Comunicaciones, que vive en /whatsapp/agentes), es un
 * 404 de verdad y no una pantalla vacía sin explicación.
 */
import { notFound } from "next/navigation";
import { DEPARTAMENTOS, esDepartamentoConPantalla } from "@strappy/ui";
import { ListaAgentes } from "@/components/agentes/lista-agentes";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: esDepartamentoConPantalla(id) ? DEPARTAMENTOS[id].etiqueta : "Departamento" };
}

export default async function PaginaDepartamento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!esDepartamentoConPantalla(id)) notFound();
  return <ListaAgentes departamento={id} />;
}
