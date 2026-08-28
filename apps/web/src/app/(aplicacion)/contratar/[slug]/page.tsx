import { notFound } from "next/navigation";
import { MarcoApp } from "@/components/marco-app";
import { AsistenteContratacion } from "@/components/negocio/asistente-contratacion";
import { datosDelMarco } from "@/lib/marco";
import { fichaDelCatalogo } from "@/lib/negocio/catalogo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const nombre = slug.charAt(0).toUpperCase() + slug.slice(1);
  return { title: `Contratar ${nombre}` };
}

export default async function PaginaFicha({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const marco = await datosDelMarco();
  const ficha = await fichaDelCatalogo(marco.actual.workspaceId, slug);
  if (!ficha) notFound();

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo={`Contratar · ${ficha.nombre}`}
    >
      <div className="mx-auto max-w-2xl p-6">
        <AsistenteContratacion ficha={ficha} />
      </div>
    </MarcoApp>
  );
}
