"use client";

/**
 * El panel de filtros.
 *
 * En un cajón y no encima de la lista: filtrar es una decisión ocasional, y
 * robarle sitio permanente a la lista para algo que se usa una vez cada media
 * hora es el error que hace que las bandejas ajenas se sientan estrechas.
 */
import { Check } from "lucide-react";
import { Drawer, DrawerContent, Button, Field, Input, cn } from "@strappy/ui";
import type { Catalogos, Filtros } from "@/lib/bandeja/tipos";

const ESTADOS: readonly { valor: Filtros["estado"]; etiqueta: string }[] = [
  { valor: "abiertas", etiqueta: "Abiertas" },
  { valor: "pospuestas", etiqueta: "Pospuestas" },
  { valor: "cerradas", etiqueta: "Cerradas" },
  { valor: "todas", etiqueta: "Todas" },
];

export function PanelFiltros({
  abierto,
  alCerrar,
  filtros,
  cambiarFiltros,
  catalogos,
}: {
  abierto: boolean;
  alCerrar: () => void;
  filtros: Filtros;
  cambiarFiltros: (cambio: Partial<Filtros>) => void;
  catalogos: Catalogos;
}) {
  return (
    <Drawer open={abierto} onOpenChange={(v) => (v ? undefined : alCerrar())}>
      <DrawerContent
        title="Filtrar la bandeja"
        description="Se suman a la pestaña que tengas abierta (Todas, Mías…)."
        width={360}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() =>
                cambiarFiltros({
                  estado: "abiertas",
                  canalId: null,
                  asignadoId: null,
                  agenteId: null,
                  etiquetaId: null,
                  desde: null,
                  hasta: null,
                  soloUrgentes: false,
                })
              }
            >
              Quitar todo
            </Button>
            <Button onClick={alCerrar}>Ver resultados</Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Grupo titulo="Estado" ayuda="Abiertas son las que siguen en curso.">
            <div className="flex flex-wrap gap-1.5">
              {ESTADOS.map((estado) => (
                <Opcion
                  key={estado.valor}
                  activa={filtros.estado === estado.valor}
                  onClick={() => cambiarFiltros({ estado: estado.valor })}
                >
                  {estado.etiqueta}
                </Opcion>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Etiquetas" ayuda="Las que le pusiste tú o tu equipo.">
            <div className="flex flex-wrap gap-1.5">
              {catalogos.etiquetas.length === 0 && (
                <p className="text-sm text-fg-muted">Todavía no has creado etiquetas.</p>
              )}
              {catalogos.etiquetas.map((etiqueta) => (
                <Opcion
                  key={etiqueta.id}
                  activa={filtros.etiquetaId === etiqueta.id}
                  color={etiqueta.color}
                  onClick={() =>
                    cambiarFiltros({
                      etiquetaId: filtros.etiquetaId === etiqueta.id ? null : etiqueta.id,
                    })
                  }
                >
                  {etiqueta.nombre}
                </Opcion>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Asignada a" ayuda="Quién del equipo se hace cargo.">
            <div className="flex flex-wrap gap-1.5">
              <Opcion
                activa={filtros.asignadoId === catalogos.yo.id}
                onClick={() =>
                  cambiarFiltros({
                    asignadoId: filtros.asignadoId === catalogos.yo.id ? null : catalogos.yo.id,
                  })
                }
              >
                A mí
              </Opcion>
              {catalogos.miembros
                .filter((miembro) => miembro.id !== catalogos.yo.id)
                .map((miembro) => (
                  <Opcion
                    key={miembro.id}
                    activa={filtros.asignadoId === miembro.id}
                    onClick={() =>
                      cambiarFiltros({
                        asignadoId: filtros.asignadoId === miembro.id ? null : miembro.id,
                      })
                    }
                  >
                    {miembro.nombre}
                  </Opcion>
                ))}
            </div>
          </Grupo>

          <Grupo titulo="Número" ayuda="Por qué número de WhatsApp entró.">
            <div className="flex flex-wrap gap-1.5">
              {catalogos.canales.map((canal) => (
                <Opcion
                  key={canal.id}
                  activa={filtros.canalId === canal.id}
                  onClick={() =>
                    cambiarFiltros({ canalId: filtros.canalId === canal.id ? null : canal.id })
                  }
                >
                  {canal.nombre}
                </Opcion>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Agente" ayuda="Qué agente de IA la atiende.">
            <div className="flex flex-wrap gap-1.5">
              {catalogos.agentes.map((agente) => (
                <Opcion
                  key={agente.id}
                  activa={filtros.agenteId === agente.id}
                  onClick={() =>
                    cambiarFiltros({ agenteId: filtros.agenteId === agente.id ? null : agente.id })
                  }
                >
                  {agente.nombre}
                </Opcion>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Fechas" ayuda="Último mensaje entre estos días.">
            <div className="flex items-end gap-2">
              <Field label="Desde" className="flex-1">
                {(propiedades) => (
                  <Input
                    {...propiedades}
                    type="date"
                    value={filtros.desde ?? ""}
                    onChange={(evento) => cambiarFiltros({ desde: evento.target.value || null })}
                  />
                )}
              </Field>
              <Field label="Hasta" className="flex-1">
                {(propiedades) => (
                  <Input
                    {...propiedades}
                    type="date"
                    value={filtros.hasta ?? ""}
                    onChange={(evento) => cambiarFiltros({ hasta: evento.target.value || null })}
                  />
                )}
              </Field>
            </div>
          </Grupo>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Un grupo de filtros con una frase que dice, sin jerga, para qué sirve. */
function Grupo({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-fg">{titulo}</h3>
        {ayuda && <p className="text-xs text-fg-muted">{ayuda}</p>}
      </div>
      {children}
    </section>
  );
}

function Opcion({
  activa,
  color,
  onClick,
  children,
}: {
  activa: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      style={
        color && activa
          ? {
              borderColor: `color-mix(in oklab, ${color}, transparent 40%)`,
              backgroundColor: `color-mix(in oklab, ${color}, transparent 82%)`,
            }
          : undefined
      }
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
        "transition-colors duration-[var(--dur-fast)]",
        activa && !color
          ? "border-[var(--brand)] bg-primary-soft text-fg"
          : activa
            ? "text-fg"
            : "border-border bg-raised text-fg-secondary hover:border-border-strong hover:text-fg",
      )}
    >
      {activa ? (
        <Check size={13} strokeWidth={2.5} aria-hidden className={color ? undefined : "text-primary-fg"} />
      ) : (
        color && <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
      {children}
    </button>
  );
}
