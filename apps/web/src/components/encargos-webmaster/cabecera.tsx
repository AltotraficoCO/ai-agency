"use client";

import * as React from "react";
import { CircleAlert, ExternalLink, Globe, CalendarClock } from "lucide-react";
import { Badge, Button, Drawer, DrawerContent, IndicadorEscribiendo } from "@strappy/ui";
import { BotonModo } from "@/components/agentes/boton-modo";
import type { ModoAgente, SitioConectado, TrabajoProgramado } from "./comun";
import type { OficioEncargos } from "./oficios";
import { FotoAgente } from "./foto-agente";

/**
 * Quién trabaja y dónde: la foto, lo conectado, si está trabajando o espera
 * respuesta, y el panel lateral del trabajo programado.
 */
export function CabeceraEncargos({
  nombreAgente,
  oficio,
  sitio,
  trabajando,
  esperaRespuesta,
  modo,
  programado,
}: {
  nombreAgente: string;
  oficio: OficioEncargos;
  sitio: SitioConectado | null;
  trabajando: boolean;
  esperaRespuesta: boolean;
  modo?: ModoAgente;
  programado?: TrabajoProgramado;
}) {
  const [programadoAbierto, setProgramadoAbierto] = React.useState(false);

  return (
    <>
      {/* ── Quién trabaja y dónde ──────────────────────────────────────── */}
      <div className="shrink-0 border-b-2 border-[var(--border-subtle)]">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-3">
          <FotoAgente src={oficio.foto} size={44} trabajando={trabajando} />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate font-display text-base font-semibold text-fg">{nombreAgente}</p>
            {sitio ? (
              <a
                href={sitio.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1.5 truncate text-2xs text-fg-muted transition-colors hover:text-primary-fg"
              >
                <Globe size={12} aria-hidden />
                {oficio.conexion.conectado(sitio.nombre)}
                <ExternalLink size={11} aria-hidden />
              </a>
            ) : (
              <p className="text-2xs text-warning-fg">{oficio.conexion.sinConectar}</p>
            )}
          </div>
          {trabajando ? (
            <span className="strappy-pop-in inline-flex items-center gap-2 rounded-full border-2 border-[color-mix(in_oklab,var(--brand),transparent_60%)] bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-fg">
              <IndicadorEscribiendo etiqueta={`${nombreAgente} está trabajando`} />
              {oficio.trabajando}
            </span>
          ) : esperaRespuesta ? (
            <Badge tone="aviso">
              <CircleAlert aria-hidden />
              Espera tu respuesta
            </Badge>
          ) : null}
          {modo ? (
            <BotonModo agentId={modo.agentId} modo={modo.actual} planDePago={modo.planDePago} />
          ) : null}
          {programado ? (
            <Button size="sm" variant="secondary" onClick={() => setProgramadoAbierto(true)}>
              <CalendarClock size={14} aria-hidden />
              <span className="hidden sm:inline">Programado</span>
              {programado.cuantos > 0 ? (
                <span className="rounded-full bg-primary-soft px-1.5 text-2xs font-semibold text-primary-fg tnum">
                  {programado.cuantos}
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>
      </div>

      {programado ? (
        <Drawer open={programadoAbierto} onOpenChange={setProgramadoAbierto}>
          <DrawerContent
            title="Trabajo que hace solo"
            description={`Lo que ${nombreAgente} repite sin que se lo pidas, y cuándo le toca.`}
            width={520}
          >
            {programado.nodo}
          </DrawerContent>
        </Drawer>
      ) : null}
    </>
  );
}
