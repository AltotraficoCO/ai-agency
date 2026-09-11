/**
 * Una base de conocimiento: qué sabe, de dónde lo sacó y quién la usa.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { MarcoApp } from "@/components/marco-app";
import { AccionesBase } from "@/components/conocimiento/acciones-base";
import { DetalleBase } from "@/components/conocimiento/detalle-base";
import { completarVectores } from "@/lib/conocimiento/completar";
import { leerCerebro } from "@/lib/conocimiento/conocimiento";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Conocimiento" };
export const dynamic = "force-dynamic";

export default async function PaginaBaseDeConocimiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marco = await datosDelMarco();
  const ficha = await leerCerebro(marco.actual.workspaceId, id);
  if (!ficha) notFound();

  // Si esta base se aprendió cuando no había búsqueda por significado, se
  // completa después de responder. Acotado y con pausa: la página se refresca
  // cada pocos segundos mientras aprende.
  const workspaceId = marco.actual.workspaceId;
  after(() => completarVectores({ workspaceId, cerebroId: ficha.id }));

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto={<Link href="/conocimiento">Conocimiento</Link>}
      titulo={ficha.nombre}
      acciones={<AccionesBase id={ficha.id} nombre={ficha.nombre} descripcion={ficha.descripcion} />}
    >
      <DetalleBase ficha={ficha} />
    </MarcoApp>
  );
}
