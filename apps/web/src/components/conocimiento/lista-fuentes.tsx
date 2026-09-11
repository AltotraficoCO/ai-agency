"use client";

/**
 * Las fuentes de una base: de dónde aprendió y cómo le fue.
 *
 * El estado se dice con palabra e icono, no solo con color. Un error enseña su
 * motivo ahí mismo, sin tener que abrir nada: si un PDF es una foto escaneada,
 * la persona tiene que leerlo en la fila.
 */
import * as React from "react";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Inbox,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, IconButton, Spinner, Tooltip, cn, toast } from "@strappy/ui";
import { accionEliminarFuente, accionReleerFuente } from "@/lib/conocimiento/acciones";
import type { EstadoFuente, FuenteVista, TipoFuenteVista } from "@/lib/conocimiento/tipos";
import { ESTADO_FUENTE, fechaRelativa, plural } from "./formato";

const ICONO_TIPO: Readonly<Record<TipoFuenteVista, LucideIcon>> = {
  web: Globe,
  archivo: FileText,
  texto: ClipboardList,
};

const FALLO = { ok: false as const, error: "No pudimos completar la acción. Vuelve a intentarlo." };

export function ListaFuentes({
  cerebroId,
  fuentes,
  onCambio,
}: {
  cerebroId: string;
  fuentes: readonly FuenteVista[];
  onCambio: () => void;
}) {
  return (
    <section
      aria-labelledby="fuentes-titulo"
      className="strappy-slide-up rounded-xl border border-border bg-raised shadow-e1 [animation-delay:60ms]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
        <h2 id="fuentes-titulo" className="flex items-center gap-2 text-lg font-semibold text-fg">
          Fuentes
          <span className="tnum rounded-full bg-hover px-2 py-0.5 text-2xs font-medium text-fg-muted">
            {fuentes.length}
          </span>
        </h2>
      </div>

      {fuentes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-hover text-fg-muted">
            <Inbox size={20} aria-hidden />
          </span>
          <p className="text-base font-semibold text-fg">Aún no le has dado nada que aprender</p>
          <p className="max-w-[48ch] text-sm text-fg-secondary">
            Usa «Añadir conocimiento» de arriba: tu web, un archivo o unos datos. Cada uno aparecerá
            aquí mientras aprende.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {fuentes.map((fuente) => (
            <FilaFuente key={fuente.id} cerebroId={cerebroId} fuente={fuente} onCambio={onCambio} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaFuente({
  cerebroId,
  fuente,
  onCambio,
}: {
  cerebroId: string;
  fuente: FuenteVista;
  onCambio: () => void;
}) {
  const [confirmando, setConfirmando] = React.useState(false);
  const [trabajando, setTrabajando] = React.useState<"releer" | "eliminar" | null>(null);
  const Icono = ICONO_TIPO[fuente.tipo];
  const ocupada = fuente.estado === "pendiente" || fuente.estado === "aprendiendo";
  const problema = fuente.estado === "error" || fuente.estado === "revisar";

  const releer = async () => {
    setTrabajando("releer");
    const resultado = await accionReleerFuente(cerebroId, fuente.id).catch(() => FALLO);
    setTrabajando(null);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success("Volviendo a leer");
    onCambio();
  };

  const eliminar = async () => {
    setTrabajando("eliminar");
    const resultado = await accionEliminarFuente(cerebroId, fuente.id).catch(() => FALLO);
    setTrabajando(null);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success(`«${fuente.titulo}» quitada`);
    setConfirmando(false);
    onCambio();
  };

  return (
    <li className="strappy-fade-in flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-hover/40">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            problema ? "bg-warning-soft text-warning-fg" : "bg-inset text-fg-secondary",
          )}
        >
          <Icono size={17} strokeWidth={1.9} aria-hidden />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-base font-medium text-fg">{fuente.titulo}</p>
            <EstadoBadge estado={fuente.estado} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-muted">
            {fuente.formato ? <span>{fuente.formato}</span> : null}
            {fuente.uri && fuente.tipo === "web" ? (
              <a
                href={fuente.uri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-[28ch] items-center gap-1 truncate hover:text-primary-fg hover:underline"
              >
                <span className="truncate">{fuente.uri.replace(/^https?:\/\//, "")}</span>
                <ExternalLink size={11} aria-hidden className="shrink-0" />
              </a>
            ) : null}
            {fuente.estado === "lista" ? <span className="tnum">{plural(fuente.fragmentos, "fragmento", "fragmentos")}</span> : null}
            <span suppressHydrationWarning>{fechaRelativa(fuente.actualizado)}</span>
          </p>
        </div>

        {!confirmando ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {fuente.tipo !== "archivo" ? (
              <Tooltip content="Volver a leer">
                <IconButton
                  label={`Volver a leer ${fuente.titulo}`}
                  size="sm"
                  disabled={ocupada}
                  loading={trabajando === "releer"}
                  onClick={() => void releer()}
                >
                  <RotateCcw size={15} strokeWidth={1.75} aria-hidden />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip content="Quitar fuente">
              <IconButton
                label={`Quitar ${fuente.titulo}`}
                size="sm"
                variant="danger"
                onClick={() => setConfirmando(true)}
              >
                <Trash2 size={15} strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
          </div>
        ) : null}
      </div>

      {fuente.detalle && problema ? (
        <p
          className={cn(
            "ml-12 flex items-start gap-1.5 rounded-md px-3 py-2 text-sm",
            fuente.estado === "error" ? "bg-danger-soft text-danger-fg" : "bg-warning-soft text-warning-fg",
          )}
        >
          {fuente.estado === "error" ? (
            <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
          )}
          {fuente.detalle}
        </p>
      ) : null}

      {confirmando ? (
        <div
          role="alertdialog"
          aria-label={`Confirmar quitar ${fuente.titulo}`}
          className="strappy-fade-in ml-12 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color-mix(in_oklab,var(--danger),transparent_60%)] bg-danger-soft px-3 py-2"
        >
          <p className="text-sm text-fg">Se olvida lo que aprendió de esta fuente. ¿Quitarla?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)} autoFocus>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={trabajando === "eliminar"}
              loadingLabel="Quitando"
              onClick={() => void eliminar()}
            >
              Quitar
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function EstadoBadge({ estado }: { estado: EstadoFuente }) {
  const { texto, tono } = ESTADO_FUENTE[estado];
  return (
    <Badge tone={tono}>
      {estado === "aprendiendo" ? <Spinner size="sm" label="" /> : null}
      {estado === "pendiente" ? <Clock aria-hidden /> : null}
      {estado === "lista" ? <Check aria-hidden /> : null}
      {estado === "revisar" ? <AlertTriangle aria-hidden /> : null}
      {estado === "error" ? <CircleAlert aria-hidden /> : null}
      {texto}
    </Badge>
  );
}
