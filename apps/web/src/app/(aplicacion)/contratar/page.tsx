import Link from "next/link";
import { ArrowRight, Check, CircleCheck, CircleDashed, Sparkles } from "lucide-react";
import { Badge, EncabezadoPagina } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { EnlaceBoton } from "@/components/enlace-boton";
import { ICONO_CAPACIDAD } from "@/components/negocio/contratar/personajes";
import { RetratoAgente } from "@/components/negocio/contratar/retrato-agente";
import { datosDelMarco } from "@/lib/marco";
import { catalogoDelEspacio, type FichaCatalogo } from "@/lib/negocio/catalogo";
import {
  agruparPorDepartamento,
  resumenDePlantilla,
} from "@/lib/negocio/contratar-departamentos";

export const metadata = { title: "Contratar agente" };
export const dynamic = "force-dynamic";

/** Cómo funciona contratar, en tres pasos que se leen de un vistazo. */
const COMO_FUNCIONA = [
  { numero: "1", titulo: "Elige", texto: "El que hace el trabajo que necesitas." },
  { numero: "2", titulo: "Conecta y ajusta", texto: "Lo que le falta y tres o cuatro datos." },
  { numero: "3", titulo: "Pruébalo", texto: "Antes de que hable con nadie de verdad." },
] as const;

/**
 * El catálogo, ordenado por departamentos.
 *
 * Contratar aquí es mirar una empresa y decidir a quién falta, así que la
 * pantalla se lee como una plantilla: los mismos departamentos y el mismo orden
 * que el menú, con quien ya trabaja para ti antes que quien puedes contratar.
 *
 * Cada ficha dice QUÉ HACE y QUÉ NECESITA CONECTADO. Ese segundo punto es el que
 * evita la decepción: contratar un Webmaster sin el sitio conectado deja al
 * cliente con un agente que no puede hacer nada.
 *
 * Lo que NO dice es un precio por agente: contratar no cuesta nada por sí mismo,
 * se pagan los créditos que gaste trabajando. Esa es la promesa del producto.
 *
 * Solo hay agentes del negocio: los de WhatsApp no se contratan, se crean.
 */
export default async function PaginaContratar() {
  const marco = await datosDelMarco();
  const catalogo = await catalogoDelEspacio(marco.actual.workspaceId);
  const grupos = agruparPorDepartamento(catalogo);
  const plantilla = resumenDePlantilla(catalogo);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Contratar agente"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <EncabezadoPagina
          titulo="Agentes listos para trabajar"
          descripcion="Contrata los que quieras: no cuestan nada por tenerlos. Solo pagas los créditos que gasten cuando trabajen."
          acciones={
            <EnlaceBoton href="/" variant="secondary">
              <Sparkles size={16} aria-hidden />
              Crear uno de WhatsApp a medida
            </EnlaceBoton>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-raised px-3 py-1 text-sm text-fg-secondary shadow-e1">
            <span className="font-medium text-fg tabular-nums">
              {plantilla.contratados} de {plantilla.total}
            </span>
            puestos cubiertos
          </span>
          <span className="text-sm text-fg-muted">
            Los mensajes de WhatsApp los cobra Meta directamente a tu cuenta.
          </span>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {COMO_FUNCIONA.map((paso) => (
            <li
              key={paso.numero}
              className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-inset px-4 py-3"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft font-mono text-sm font-semibold text-primary-fg">
                {paso.numero}
              </span>
              <span className="flex flex-col">
                <span className="text-base font-medium text-fg">{paso.titulo}</span>
                <span className="text-sm text-fg-muted">{paso.texto}</span>
              </span>
            </li>
          ))}
        </ol>

        {grupos.map((grupo) => {
          const total = grupo.contratados.length + grupo.disponibles.length;
          return (
            <section key={grupo.id} className="flex flex-col gap-4" aria-labelledby={`dep-${grupo.id}`}>
              <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] pb-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id={`dep-${grupo.id}`} className="text-xl font-semibold tracking-tight text-fg">
                    {grupo.etiqueta}
                  </h2>
                  <span className="text-sm text-fg-muted tabular-nums">
                    {grupo.contratados.length > 0
                      ? `${grupo.contratados.length} en tu equipo · ${grupo.disponibles.length} por contratar`
                      : `${total} por contratar`}
                  </span>
                </div>
                <p className="text-base text-fg-secondary">{grupo.descripcion}</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {[...grupo.contratados, ...grupo.disponibles].map((ficha, indice) => (
                  <TarjetaDelCatalogo key={ficha.slug} ficha={ficha} indice={indice} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </MarcoApp>
  );
}

/**
 * Una ficha del catálogo.
 *
 * Toda la tarjeta lleva a la ficha; los botones van por encima con su propio
 * enlace para no anidar elementos interactivos.
 */
function TarjetaDelCatalogo({ ficha, indice }: { ficha: FichaCatalogo; indice: number }) {
  const pendientes = ficha.conexiones.filter((c) => !c.lista).length;
  const destinoFicha = `/contratar/${ficha.slug}`;

  return (
    <article
      className="strappy-slide-up group relative flex flex-col overflow-hidden rounded-xl border border-border bg-raised shadow-e1 transition-[transform,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:shadow-e2 motion-reduce:hover:translate-y-0"
      style={{ animationDelay: `${indice * 60}ms` }}
    >
      <Link
        href={destinoFicha}
        aria-label={`Ver la ficha de ${ficha.nombre}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
      />

      <div className="pointer-events-none relative flex h-48 items-center justify-center border-b border-[var(--border-subtle)] bg-inset">
        <RetratoAgente slug={ficha.slug} tamano={168} />
        {ficha.contratado ? (
          <Badge tone="exito" className="absolute left-3 top-3 gap-1">
            <Check size={12} strokeWidth={2.5} aria-hidden />
            En tu equipo
          </Badge>
        ) : null}
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col gap-5 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-fg">{ficha.nombre}</h3>
          {ficha.tagline ? <p className="text-base text-fg-secondary">{ficha.tagline}</p> : null}
        </div>

        {ficha.capacidades.length > 0 ? (
          <ul className="flex flex-col gap-2.5" aria-label="Qué hace">
            {ficha.capacidades.slice(0, 3).map((capacidad) => {
              const Icono = ICONO_CAPACIDAD[capacidad.icono];
              return (
                <li key={capacidad.titulo} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-fg">
                    <Icono size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="text-base text-fg">{capacidad.titulo}</span>
                </li>
              );
            })}
          </ul>
        ) : ficha.descripcion ? (
          <p className="text-base text-fg-secondary">{ficha.descripcion}</p>
        ) : null}

        {ficha.conexiones.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-2xs font-medium uppercase tracking-wide text-fg-muted">
              Necesita conectado
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {ficha.conexiones.map((c) => (
                <li
                  key={c.clave}
                  className={
                    c.lista
                      ? "inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-sm text-success-fg"
                      : "inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-sm text-warning-fg"
                  }
                >
                  {c.lista ? (
                    <CircleCheck size={14} strokeWidth={2} aria-hidden />
                  ) : (
                    <CircleDashed size={14} strokeWidth={2} aria-hidden />
                  )}
                  {c.nombre}
                  <span className="sr-only">{c.lista ? ": listo" : ": por conectar"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* El aviso va ANTES de los botones para que queden alineados abajo en todas las tarjetas. */}
        <div className="mt-auto flex flex-col gap-3 pt-1">
          {!ficha.contratado && pendientes > 0 ? (
            <p className="text-sm text-fg-muted">Puedes contratarlo ya y conectar lo que falta después.</p>
          ) : null}
          <div className="pointer-events-auto relative z-10 flex flex-wrap items-center gap-2">
            {ficha.contratado && ficha.agenteId ? (
              <>
                <EnlaceBoton href={`/agentes/${ficha.agenteId}`} className="flex-1">
                  Abrir {ficha.nombre}
                  <ArrowRight size={16} aria-hidden />
                </EnlaceBoton>
                <EnlaceBoton href={destinoFicha} variant="ghost">
                  Ver ficha
                </EnlaceBoton>
              </>
            ) : (
              <EnlaceBoton href={destinoFicha} className="flex-1">
                Contratar {ficha.nombre}
                <ArrowRight size={16} aria-hidden />
              </EnlaceBoton>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
