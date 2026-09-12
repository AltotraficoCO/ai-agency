import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CircleCheck, CircleDashed } from "lucide-react";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { SelectorFoto } from "@/components/agentes/selector-foto";
import { AsistenteContratacion } from "@/components/negocio/asistente-contratacion";
import { ICONO_CAPACIDAD } from "@/components/negocio/contratar/personajes";
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
 * A la izquierda, quién es: su cara, qué hace con detalle y qué necesita
 * conectado. A la derecha, el asistente paso a paso. En móvil todo se apila y
 * el personaje se encoge para no empujar al asistente fuera de la pantalla.
 *
 * El detalle de cada capacidad SOLO se lee aquí: en el catálogo cabe el titular
 * y en la ficha se explica. Por eso la ficha es la que convence.
 */
export default async function PaginaFicha({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const marco = await datosDelMarco();
  const ficha = await fichaDelCatalogo(marco.actual.workspaceId, slug);
  if (!ficha) notFound();

  const pendientes = ficha.conexiones.filter((c) => !c.lista);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Contratar agente"
      titulo={ficha.nombre}
    >
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <aside className="strappy-slide-up flex flex-col gap-4 lg:sticky lg:top-8">
          <Link
            href="/contratar"
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={14} aria-hidden />
            Volver al catálogo
          </Link>

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-raised p-5 shadow-e1">
            <div className="flex items-center gap-4 lg:flex-col lg:items-stretch">
              <div className="flex justify-center rounded-lg bg-inset py-3">
                <RetratoAgente slug={ficha.slug} imagen={ficha.avatar} tamano={96} className="lg:hidden" />
                <RetratoAgente
                  slug={ficha.slug}
                  imagen={ficha.avatar}
                  tamano={200}
                  className="hidden lg:grid"
                />
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

            {ficha.capacidades.length > 0 ? (
              <ul className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
                {ficha.capacidades.map((capacidad) => {
                  const Icono = ICONO_CAPACIDAD[capacidad.icono];
                  return (
                    <li key={capacidad.titulo} className="flex items-start gap-2.5">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-fg">
                        <Icono size={14} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-base font-medium text-fg">{capacidad.titulo}</span>
                        {capacidad.detalle ? (
                          <span className="text-sm text-fg-muted">{capacidad.detalle}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : ficha.descripcion ? (
              <p className="border-t border-[var(--border-subtle)] pt-4 text-base text-fg-secondary">
                {ficha.descripcion}
              </p>
            ) : null}

            {ficha.conexiones.length > 0 ? (
              <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
                <p className="text-2xs font-medium uppercase tracking-wide text-fg-muted">
                  Necesita conectado
                </p>
                <ul className="flex flex-col gap-2">
                  {ficha.conexiones.map((c) => (
                    <li key={c.clave} className="flex items-start gap-2">
                      <span className={c.lista ? "mt-0.5 text-success-fg" : "mt-0.5 text-warning-fg"}>
                        {c.lista ? (
                          <CircleCheck size={16} strokeWidth={2} aria-hidden />
                        ) : (
                          <CircleDashed size={16} strokeWidth={2} aria-hidden />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <Link
                          href={c.ruta}
                          className="w-fit cursor-pointer text-base font-medium text-fg underline-offset-4 hover:underline"
                        >
                          {c.nombre}
                        </Link>
                        <span className="text-sm text-fg-muted">{c.descripcion}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {pendientes.length > 0 ? (
                  <p className="text-sm text-fg-muted">
                    Puedes contratarlo ya y conectar lo que falta después.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/*
            La cara la elige el cliente, y solo cuando el agente ya es suyo: se
            guarda en SU agente, no en el catálogo, que lo ven todos los espacios.
          */}
          {ficha.contratado && ficha.agenteId ? (
            <SelectorFoto
              agentId={ficha.agenteId}
              actual={ficha.avatar}
              nombre={ficha.nombre}
              variante="catalogo"
              titulo="Su cara"
              ayuda="Elige con cuál lo reconoces en tus listas."
            />
          ) : null}

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
