/**
 * Una base de conocimiento: qué sabe, de dónde lo sacó y quién la usa.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarcoApp } from "@/components/marco-app";
import { AccionesBase } from "@/components/conocimiento/acciones-base";
import { DetalleBase } from "@/components/conocimiento/detalle-base";
import { leerCerebro } from "@/lib/conocimiento/conocimiento";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Conocimiento" };
export const dynamic = "force-dynamic";

export default async function PaginaBaseDeConocimiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marco = await datosDelMarco();
  const ficha = await leerCerebro(marco.actual.workspaceId, id);
  if (!ficha) notFound();

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
