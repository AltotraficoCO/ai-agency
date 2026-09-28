"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleStop, Trash2 } from "lucide-react";
import { Badge, cn } from "@strappy/ui";
import { TextoStrap } from "@/components/meta/texto-strap";
import { RegistroTrabajo, type EquipoVista } from "@/components/conversacion/registro-trabajo";
import type { EncargoVista } from "@/lib/encargos/encargos";
import { EN_CURSO, ETIQUETAS, type Acciones } from "./comun";
import { FotoAgente } from "./foto-agente";
import { Aprobacion } from "./aprobacion";
import { Pregunta } from "./pregunta";

export function Encargo({
  encargo,
  nombreAgente,
  foto,
  textoTrabajando,
  resaltado,
  equipo,
  decidir,
  responder,
  eliminar,
  parar,
}: {
  encargo: EncargoVista;
  nombreAgente: string;
  foto: string;
  /** Lo que dice mientras trabaja, el de SU oficio: el Administrativo no trabaja en tu web. */
  textoTrabajando: string;
  resaltado: boolean;
  equipo?: EquipoVista;
} & Acciones) {
  const router = useRouter();
  const [borrando, setBorrando] = React.useState(false);
  const [parando, setParando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const etiqueta = ETIQUETAS[encargo.estado];
  const enCurso = EN_CURSO.has(encargo.estado);
  // El contrato trae `pasos`; mientras el backend no los rellene llega vacío.
  const pasos = encargo.pasos ?? [];

  async function borrar() {
    if (!window.confirm("¿Eliminar este encargo del historial? Lo que ya hizo se queda como está.")) {
      return;
    }
    setBorrando(true);
    setError(null);
    const resultado = await eliminar(encargo.id);
    setBorrando(false);
    if (resultado.ok) router.refresh();
    else setError(resultado.error);
  }

  async function detener() {
    if (
      !window.confirm(
        "¿Parar este encargo? Lo que el agente ya cambió en tu sitio se queda como está, " +
          "y solo se te cobran los créditos gastados hasta ahora.",
      )
    ) {
      return;
    }
    setParando(true);
    setError(null);
    const resultado = await parar(encargo.id);
    setParando(false);
    if (resultado.ok) router.refresh();
    else setError(resultado.error);
  }

  return (
    <li
      id={`encargo-${encargo.id}`}
      className={cn(
        "strappy-slide-up group flex scroll-mt-4 flex-col gap-3 rounded-2xl transition-[box-shadow,background-color] duration-[var(--dur-slow)]",
        resaltado && "bg-[color-mix(in_oklab,var(--brand),transparent_94%)] p-3 ring-2 ring-[color-mix(in_oklab,var(--brand),transparent_60%)]",
      )}
    >
      {/* Lo que pidió la persona */}
      <div className="flex items-start justify-end gap-2">
        {/* Parar lo que está en marcha. Tarda unos segundos: el worker lo suelta
            en su siguiente latido, y hasta entonces sigue siendo suyo. */}
        {enCurso && (
          <button
            type="button"
            onClick={detener}
            disabled={parando}
            aria-label="Parar este encargo"
            title="Parar este encargo"
            className="mt-1.5 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger-fg disabled:opacity-40"
          >
            <CircleStop size={13} strokeWidth={1.75} aria-hidden />
            {parando ? "Parando…" : "Parar"}
          </button>
        )}
        {encargo.estado !== "running" && (
          <button
            type="button"
            onClick={borrar}
            disabled={borrando}
            aria-label="Eliminar encargo"
            title="Eliminar encargo"
            className="mt-1.5 grid size-7 cursor-pointer place-items-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger-fg focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-selected px-4 py-2.5 text-md text-fg shadow-e1">
          {encargo.detalle ?? encargo.titulo}
        </div>
      </div>

      {/* Lo que hace o contesta el agente */}
      <div className="flex items-start gap-2.5">
        <span className="mt-1">
          <FotoAgente src={foto} size={32} trabajando={encargo.estado === "running"} />
        </span>
        <div className="flex min-w-0 max-w-[88%] flex-1 flex-col gap-3 rounded-2xl rounded-tl-md border-2 border-[var(--border-subtle)] bg-raised px-4 py-3 shadow-e1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{nombreAgente}</span>
            <Badge tone={etiqueta.tono}>{etiqueta.texto}</Badge>
            {encargo.creditos > 0 && (
              <span className="tnum ml-auto text-2xs text-fg-muted">{encargo.creditos} créditos</span>
            )}
          </div>

          {(enCurso || pasos.length > 0) && (
            <RegistroTrabajo
              pasos={pasos}
              equipo={equipo}
              activo={enCurso}
              textoActivo={encargo.estado === "queued" ? "En cola, empiezo en un momento" : textoTrabajando}
            />
          )}
          {encargo.estado === "running" && pasos.length === 0 && (
            <p className="text-2xs text-fg-muted">Suele tardar entre uno y cinco minutos. Puedes seguir con lo tuyo.</p>
          )}

          {encargo.resumen && encargo.aprobaciones.length === 0 && (
            <TextoStrap texto={encargo.resumen} />
          )}

          {/*
            Lo que el agente hizo y se puede ver: hoy, las imágenes del
            Diseñador. Sin esto entregaría «te preparé la portada» sin portada,
            y el cliente tendría que creérselo.
          */}
          {(encargo.imagenes ?? []).length > 0 && (
            <ul className="grid grid-cols-2 gap-2">
              {(encargo.imagenes ?? []).map((imagen, i) => (
                <li key={`${encargo.id}-img-${i}`} className="min-w-0">
                  <a
                    href={imagen.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-xl border-2 border-[var(--border-subtle)] transition-[box-shadow] hover:shadow-e2"
                    title="Abrir la imagen en grande"
                  >
                    {/* Es un `data:` de la evidencia, no una URL remota: el
                        optimizador de Next no puede con ella. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagen.src}
                      alt={imagen.titulo}
                      className="block h-auto w-full bg-sunken object-cover"
                      loading="lazy"
                    />
                  </a>
                  <p className="mt-1 truncate text-2xs text-fg-muted" title={imagen.titulo}>
                    {imagen.titulo}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {encargo.estado === "failed" && encargo.error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{encargo.error}</p>
          )}

          {encargo.aprobaciones.map((aprobacion) =>
            aprobacion.tipo === "pregunta" ? (
              <Pregunta key={aprobacion.id} aprobacion={aprobacion} responder={responder} onError={setError} />
            ) : (
              <Aprobacion key={aprobacion.id} aprobacion={aprobacion} decidir={decidir} onError={setError} />
            ),
          )}

          {error && (
            <p className="text-sm text-danger-fg" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
