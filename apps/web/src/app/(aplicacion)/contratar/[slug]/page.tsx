import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { AsistenteContratacion } from "@/components/negocio/asistente-contratacion";
import { RetratoAgente } from "@/components/negocio/contratar/retrato-agente";
import { datosDelMarco } from "@/lib/marco";
import { accionCancelarAgente } from "@/lib/negocio/acciones";
import { fichaDelCatalogo } from "@/lib/negocio/catalogo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const nombre = slug.charAt(0).toUpperCase() + slug.slice(1);
  return { title: `Contratar ${nombre}` };
}

/**
 * La ficha de un agente del catálogo.
 *
 * A la izquierda, quién es y cuánto cuesta, siempre a la vista; a la derecha,
 * el asistente paso a paso. En móvil el personaje se encoge a una fila encima
 * del asistente para no empujarlo fuera de la pantalla.
 */
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
      contexto="Contratar agente"
      titulo={ficha.nombre}
    >
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <aside className="strappy-slide-up flex flex-col gap-4 lg:sticky lg:top-8">
          <Link
            href="/contratar"
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={14} aria-hidden />
            Volver al catálogo
          </Link>

          <div className="flex items-center gap-4 rounded-xl border border-border bg-raised p-4 shadow-e1 lg:flex-col lg:items-stretch lg:p-5">
            <div className="flex justify-center rounded-lg bg-inset lg:py-4">
              <RetratoAgente slug={ficha.slug} tamano={88} className="lg:hidden" />
              <RetratoAgente slug={ficha.slug} tamano={180} className="hidden lg:grid" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-fg">{ficha.nombre}</h2>
                {ficha.contratado ? (
                  <Badge tone="exito" className="gap-1">
                    <Check size={12} strokeWidth={2.5} aria-hidden />
                    Contratado
                  </Badge>
                ) : null}
              </div>
              {ficha.tagline ? <p className="text-base text-fg-secondary">{ficha.tagline}</p> : null}
              {/* Tenerlo contratado no cuesta nada: se paga lo que gaste trabajando. */}
              <p className="pt-1 text-sm text-fg-muted">Sin cuota. Pagas los créditos que gaste.</p>
            </div>
          </div>

          {/*
            Dar de baja vive aquí, discreto y sin confirmación aparatosa: no
            borra nada. El contrato se cancela, el agente deja de atender y sus
            instrucciones y su conocimiento siguen ahí por si vuelve.
          */}
          {ficha.contratado ? (
            <form
              action={async (datos: FormData) => {
                "use server";
                await accionCancelarAgente(datos);
              }}
            >
              <input type="hidden" name="slug" value={ficha.slug} />
              <button
                type="submit"
                className="w-full cursor-pointer rounded-lg border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-peligro hover:text-peligro"
              >
                Dar de baja
              </button>
              <p className="pt-2 text-xs text-fg-muted">
                Deja de trabajar para ti. Guardamos sus instrucciones por si lo vuelves a contratar.
              </p>
            </form>
          ) : null}
        </aside>

        <AsistenteContratacion ficha={ficha} />
      </div>
    </MarcoApp>
  );
}
