import Image from "next/image";
import {
  DatabaseBackup,
  FileText,
  LayoutTemplate,
  Megaphone,
  Puzzle,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { IconoSinPersonaje, personajeDe } from "@/components/negocio/contratar/personajes";
import {
  formatearDinero,
  formatearHoras,
  type AjustesImpacto,
  type ResumenImpacto,
  type TipoTrabajo,
} from "@/lib/negocio/impacto-calculo";
import type { AgenteDelNegocio } from "@/lib/negocio/impacto";

export const ICONO_TRABAJO: Readonly<Record<TipoTrabajo, LucideIcon>> = {
  diseno: LayoutTemplate,
  contenido: FileText,
  plugins: Puzzle,
  copias: DatabaseBackup,
  usuarios: Users,
  ajustes: SlidersHorizontal,
  revision: ScanSearch,
  campanas: Megaphone,
  otro: Sparkles,
};

/** La cara de un agente: su personaje de plastilina o, si no tiene, el robot. */
export function CaraAgente({ slug, nombre, tamano = 40 }: { slug: string; nombre: string; tamano?: number }) {
  const personaje = personajeDe(slug);
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-inset shadow-e1"
      style={{ width: tamano, height: tamano, backgroundImage: personaje.halo }}
    >
      {personaje.imagen ? (
        <Image src={personaje.imagen} alt={nombre} width={tamano} height={tamano} className="object-cover" />
      ) : (
        <IconoSinPersonaje size={tamano / 2} strokeWidth={1.75} className="text-fg-muted" aria-label={nombre} />
      )}
    </span>
  );
}

/** Barra de proporción: comparar dos barras es más rápido que comparar dos cifras. */
function Barra({ fraccion, etiqueta }: { fraccion: number; etiqueta: string }) {
  const ancho = Math.max(0, Math.min(1, fraccion)) * 100;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-inset shadow-hundido"
      role="img"
      aria-label={etiqueta}
    >
      <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${ancho}%` }} />
    </div>
  );
}

export function DesglosePorAgente({
  resumen,
  agentes,
  ajustes,
}: {
  resumen: ResumenImpacto;
  agentes: readonly AgenteDelNegocio[];
  ajustes: AjustesImpacto;
}) {
  const total = resumen.actual.minutos;
  // Todos los agentes contratados salen, también los que no trabajaron: saber
  // que Marketing no hizo nada este mes también es información.
  const filas = agentes
    .map((agente) => {
      const datos = resumen.porAgente.find((p) => p.agenteId === agente.id);
      return { agente, completados: datos?.completados ?? 0, minutos: datos?.minutos ?? 0, ahorro: datos?.ahorro ?? 0 };
    })
    .sort((a, b) => b.minutos - a.minutos);

  return (
    <Card className="strappy-slide-up">
      <CardHeader>
        <CardTitle>Por agente</CardTitle>
        <CardDescription>Quién hizo el trabajo y cuánto te ahorró cada uno.</CardDescription>
      </CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-4">
          {filas.map(({ agente, completados, minutos, ahorro }) => (
            <li key={agente.id} className="flex items-center gap-3">
              <CaraAgente slug={agente.slug} nombre={agente.nombre} tamano={44} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium text-fg">{agente.nombre}</span>
                  <span className="shrink-0 font-semibold text-primary-fg tabular-nums">
                    {formatearDinero(ahorro, ajustes.moneda)}
                  </span>
                </div>
                <Barra
                  fraccion={total > 0 ? minutos / total : 0}
                  etiqueta={`${total > 0 ? Math.round((minutos / total) * 100) : 0}% del tiempo ahorrado`}
                />
                <span className="text-2xs text-fg-muted tabular-nums">
                  {completados === 0
                    ? "Sin encargos terminados en este periodo"
                    : `${completados} ${completados === 1 ? "encargo" : "encargos"} · ${formatearHoras(minutos)} de trabajo humano`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export function DesglosePorTipo({ resumen, ajustes }: { resumen: ResumenImpacto; ajustes: AjustesImpacto }) {
  const total = resumen.actual.minutos;
  return (
    <Card className="strappy-slide-up">
      <CardHeader>
        <CardTitle>Por tipo de trabajo</CardTitle>
        <CardDescription>En qué se fue el tiempo que no tuviste que dedicarle tú.</CardDescription>
      </CardHeader>
      <CardBody>
        {resumen.porTipo.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">Todavía no hay trabajo que repartir.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {resumen.porTipo.map((fila) => {
              const Icono = ICONO_TRABAJO[fila.tipo];
              const porcentaje = total > 0 ? Math.round((fila.minutos / total) * 100) : 0;
              return (
                <li key={fila.tipo} className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-hover text-fg-secondary">
                    <Icono size={18} strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium text-fg">{fila.etiqueta}</span>
                      <span className="shrink-0 text-sm text-fg-secondary tabular-nums">
                        {formatearHoras(fila.minutos)} · {porcentaje}%
                      </span>
                    </div>
                    <Barra fraccion={total > 0 ? fila.minutos / total : 0} etiqueta={`${porcentaje}% del tiempo`} />
                    <span className="text-2xs text-fg-muted tabular-nums">
                      {fila.encargos} {fila.encargos === 1 ? "encargo" : "encargos"} ·{" "}
                      {formatearDinero(fila.ahorro, ajustes.moneda)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
