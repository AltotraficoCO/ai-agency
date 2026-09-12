"use client";

/**
 * La propuesta de «Mejorar con IA», antes de tocar nada.
 *
 * Se enseña sección por sección, con lo que hay ahora al lado de lo que
 * propone, y con una casilla por sección. Aceptar todo o nada obligaría a
 * tragarse un cambio que no gusta para quedarse con los tres que sí; ir campo
 * por campo convertiría una revisión de treinta segundos en un formulario.
 * La sección es la unidad con la que ya piensa el resto de la pantalla.
 *
 * Nada se aplica hasta que la persona pulsa. Y lo que aplica se puede deshacer
 * sin recargar, porque el estado anterior se guarda en la pantalla.
 */
import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { Button, Modal, ModalContent, cn } from "@strappy/ui";
import type { CambioPropuesto, SeccionMejorable } from "@/lib/agentes/mejora";

export function PropuestaMejora({
  abierta,
  cambios,
  resumen,
  creditos,
  onAplicar,
  onCerrar,
}: {
  abierta: boolean;
  cambios: readonly CambioPropuesto[];
  resumen: string;
  creditos: number;
  onAplicar: (secciones: SeccionMejorable[]) => void;
  onCerrar: () => void;
}) {
  // Al llegar una propuesta nueva, todo viene marcado: lo normal es querer la
  // mejora entera, y quitar lo que no convence es menos trabajo que marcar de
  // una en una.
  //
  // El reinicio se hace comparando con la propuesta anterior DURANTE el render,
  // no en un efecto: un `setState` dentro de un efecto encadena un render de
  // más y deja un parpadeo con las casillas de la propuesta vieja.
  const firma = cambios.map((c) => c.seccion).join(",");
  const [firmaPrevia, setFirmaPrevia] = React.useState(firma);
  const [aceptadas, setAceptadas] = React.useState<Set<SeccionMejorable>>(
    () => new Set(cambios.map((c) => c.seccion)),
  );
  if (firma !== firmaPrevia) {
    setFirmaPrevia(firma);
    setAceptadas(new Set(cambios.map((c) => c.seccion)));
  }

  const alternar = (seccion: SeccionMejorable) => {
    setAceptadas((previas) => {
      const siguiente = new Set(previas);
      if (siguiente.has(seccion)) siguiente.delete(seccion);
      else siguiente.add(seccion);
      return siguiente;
    });
  };

  return (
    <Modal open={abierta} onOpenChange={(v) => (v ? undefined : onCerrar())}>
      <ModalContent
        title="Así quedarían tus instrucciones"
        description={resumen}
        size="lg"
        footer={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-fg-muted">
              {creditos > 0
                ? `Esta mejora consumió ${creditos.toLocaleString("es-CO")} ${creditos === 1 ? "crédito" : "créditos"}.`
                : "Esta mejora no consumió créditos."}{" "}
              Nada se guarda hasta que pulses «Guardar borrador».
            </p>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="secondary" onClick={onCerrar}>
                Descartar
              </Button>
              <Button disabled={aceptadas.size === 0} onClick={() => onAplicar([...aceptadas])}>
                <Check size={16} aria-hidden />
                Aplicar {aceptadas.size > 0 ? `(${aceptadas.size})` : ""}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {cambios.length === 0 ? (
            <p className="text-base text-fg-secondary">
              Tus instrucciones ya están bien: no he encontrado nada que mejorar.
            </p>
          ) : (
            cambios.map((cambio) => {
              const activa = aceptadas.has(cambio.seccion);
              return (
                <section
                  key={cambio.seccion}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
                    activa ? "border-[color-mix(in_oklab,var(--brand),transparent_55%)] bg-raised" : "border-border",
                  )}
                >
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={activa}
                      onChange={() => alternar(cambio.seccion)}
                      className="size-4 cursor-pointer accent-[var(--brand)]"
                    />
                    <span className="text-base font-semibold text-fg">{cambio.titulo}</span>
                    <span className="ml-auto text-2xs text-fg-muted">
                      {activa ? "Se aplica" : "Se queda como está"}
                    </span>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Columna titulo="Ahora" lineas={cambio.antes} apagada />
                    <Columna titulo="Propuesta" lineas={cambio.despues} />
                  </div>
                </section>
              );
            })
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}

function Columna({
  titulo,
  lineas,
  apagada = false,
}: {
  titulo: string;
  lineas: readonly string[];
  apagada?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs font-medium uppercase tracking-wide text-fg-muted">{titulo}</p>
      {lineas.length === 0 ? (
        <p className={cn("text-sm", apagada ? "text-fg-muted" : "text-fg")}>Nada escrito.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lineas.map((linea, i) => (
            <li
              key={i}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm",
                apagada ? "bg-inset text-fg-secondary" : "bg-primary-soft text-fg",
              )}
            >
              {linea}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El botón, con su estado de espera. Vive aquí para no repetirlo en dos sitios. */
export function BotonMejorar({
  cargando,
  onClick,
}: {
  cargando: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      loading={cargando}
      loadingLabel="Mejorando"
    >
      <Sparkles size={16} aria-hidden />
      Mejorar con IA
    </Button>
  );
}
