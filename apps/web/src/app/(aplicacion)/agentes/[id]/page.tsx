import { redirect } from "next/navigation";

export default async function FichaAgente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/agentes/${id}/instrucciones`);
}
