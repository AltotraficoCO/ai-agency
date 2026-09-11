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
import { prepararRecuperacionAutomatica } from "@/lib/conocimiento/recuperar";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Conocimiento" };
export const dynamic = "force-dynamic";

export default async function PaginaBaseDeConocimiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marco = await datosDelMarco();
  const workspaceId = marco.actual.workspaceId;

  // Las fuentes que fallaron por el proveedor de búsqueda (no por culpa de la
  // persona) se ponen en cola ANTES de leer la base: así la pantalla ya enseña
  // que están aprendiendo y se refresca sola. Acotado, como mucho una vez al día
  // por fuente, y nunca lanza.
  const recuperacion = /^[0-9a-f-]{36}$/i.test(id)
    ? await prepararRecuperacionAutomatica({ workspaceId, cerebroId: id })
    : null;

  const ficha = await leerCerebro(workspaceId, id);
  if (!ficha) notFound();

  // Después de responder: primero volver a aprender lo recuperado y luego
  // completar la búsqueda por significado de lo que se aprendió sin ella.
  after(async () => {
    if (recuperacion) await recuperacion();
    await completarVectores({ workspaceId, cerebroId: ficha.id });
  });

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
