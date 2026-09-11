/**
 * Una base de conocimiento en la lista.
 *
 * Toda la tarjeta navega. Dice de un vistazo lo que importa: si ya sabe algo,
 * si está aprendiendo o si algo falló, y qué agentes la están usando.
 */
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Avatar, Badge, Spinner, cn } from "@strappy/ui";
import type { ResumenCerebro } from "@/lib/conocimiento/tipos";
import { estadoDeBase, fechaRelativa, plural } from "./formato";

export function TarjetaBase({ base, indice = 0 }: { base: ResumenCerebro; indice?: number }) {
  const estado = estadoDeBase(base);
  const visibles = base.agentes.slice(0, 3);
  const resto = base.agentes.length - visibles.length;

  return (
    <Link
      href={`/conocimiento/${base.id}`}
      style={{ animationDelay: `${Math.min(indice, 8) * 40}ms` }}
      className={cn(
        "strappy-slide-up group flex cursor-pointer flex-col gap-4 rounded-xl border border-border bg-raised p-5",
        "transition-[transform,border-color,background-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out-quart)]",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:bg-hover hover:shadow-e2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] motion-reduce:hover:translate-y-0",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
          <BookOpen size={18} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-lg font-semibold text-fg">{base.nombre}</h3>
          <p className="line-clamp-2 text-sm text-fg-secondary">
            {base.descripcion ?? "Sin descripción"}
          </p>
        </div>
        <Badge tone={estado.tono} className="shrink-0">
          {estado.animado ? <Spinner size="sm" label="" /> : null}
          {estado.texto}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-inset px-3 py-2">
          <dt className="text-2xs uppercase tracking-wide text-fg-muted">Fuentes</dt>
          <dd className="tnum text-xl font-semibold text-fg">{base.fuentes.toLocaleString("es-CO")}</dd>
        </div>
        <div className="rounded-lg bg-inset px-3 py-2">
          <dt className="text-2xs uppercase tracking-wide text-fg-muted">Fragmentos</dt>
          <dd className="tnum text-xl font-semibold text-fg">{base.fragmentos.toLocaleString("es-CO")}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
        {base.agentes.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex -space-x-1.5">
              {visibles.map((agente) => (
                <Avatar
                  key={agente.id}
                  name={agente.nombre}
                  size="sm"
                  tone="ia"
                  className="ring-2 ring-[var(--s-raised)]"
                  title={agente.nombre}
                />
              ))}
            </span>
            <span className="truncate text-sm text-fg-secondary">
              {resto > 0
                ? `${visibles.map((a) => a.nombre).join(", ")} y ${resto} más`
                : plural(base.agentes.length, "agente la usa", "agentes la usan")}
            </span>
          </div>
        ) : (
          <span className="text-sm text-fg-muted">Ningún agente la usa aún</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5 text-2xs text-fg-muted">
          {fechaRelativa(base.actualizado)}
          <ArrowRight
            size={14}
            aria-hidden
            className="transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary-fg"
          />
        </span>
      </div>
    </Link>
  );
}
