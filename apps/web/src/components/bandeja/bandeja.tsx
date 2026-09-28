"use client";

/**
 * La bandeja.
 *
 * Cuatro columnas en pantallas grandes: rail (64) · lista (340) · hilo · ficha
 * del contacto (320). Por debajo de 1440 px la ficha se convierte en cajón, y
 * por debajo de 1024 la lista y el hilo se apilan: en un móvil, ver media lista
 * y medio hilo es no ver ninguno de los dos.
 *
 * Este componente es el único que tiene estado de verdad. Los demás reciben
 * datos y devuelven intenciones; así el estado del mando —lo más delicado de la
 * pantalla— vive en un solo sitio y se relee del servidor después de cada
 * acción, en lugar de adivinarse en el cliente.
 */
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button, Drawer, DrawerContent, IconButton, toast, cn } from "@strappy/ui";
import { BarraApp } from "@/components/marco-app";
import * as api from "./api";
import { BarraControl } from "./barra-control";
import { CabeceraHilo } from "./cabecera-hilo";
import { Composer } from "./composer";
import { DialogoRespuestaRapida } from "./dialogo-respuesta-rapida";
import { useEstadoBandeja, type DatosIniciales } from "./estado";
import { Hilo, SinHiloSeleccionado } from "./hilo";
import { IndicadorConexion } from "./indicador-conexion";
import { Lista } from "./lista";
import { PanelContacto } from "./panel-contacto";
import { useTecladoBandeja } from "./teclado";

export type { DatosIniciales };

export function Bandeja({ inicial }: { inicial: DatosIniciales }) {
  const {
    catalogos,
    setCatalogos,
    filtros,
    conversaciones,
    contadores,
    cargandoLista,
    seleccionada,
    setSeleccionada,
    hilo,
    cargandoHilo,
    trabajando,
    enviando,
    fallo,
    sembrando,
    fichaAbierta,
    setFichaAbierta,
    borradorRespuesta,
    setBorradorRespuesta,
    refBusqueda,
    refComposer,
    refEtiquetas,
    seleccionadaRef,
    conexion,
    reintentar,
    refrescarTodo,
    abrir,
    ejecutarAccion,
    tomarControl,
    devolverControl,
    alternarControl,
    enviarMensaje,
    anotar,
    resumir,
    crearEtiqueta,
    sembrar,
    cambiarFiltros,
  } = useEstadoBandeja(inicial);

  // ── Teclado ────────────────────────────────────────────────────────────────
  useTecladoBandeja({
    conversaciones,
    abrir,
    alternarControl,
    seleccionadaRef,
    refBusqueda,
    refEtiquetas,
    setFichaAbierta,
  });

  // ── Pintado ────────────────────────────────────────────────────────────────

  return (
    <>
      <BarraApp
          contexto="WhatsApp"
          titulo="Bandeja"
          acciones={
            <>
              <IndicadorConexion estado={conexion} alReintentar={reintentar} />
              <IconButton label="Actualizar ahora" size="sm" onClick={refrescarTodo}>
                <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
              </IconButton>
            </>
          }
        />
      <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex h-full min-h-0 flex-col">
        {conexion === "caido" && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--warning),transparent_50%)] bg-[var(--warning-soft)] px-4 py-2 text-base text-fg"
          >
            <AlertTriangle size={16} strokeWidth={1.75} aria-hidden className="text-[var(--warning-fg)]" />
            <span className="min-w-0 flex-1">
              Se cayó la conexión en vivo. Seguimos actualizando cada 8 segundos, pero puede que veas
              los mensajes con retraso.
            </span>
            <Button size="sm" variant="secondary" onClick={reintentar}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
              Reintentar
            </Button>
          </div>
        )}

        {fallo && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--danger),transparent_55%)] bg-[var(--danger-soft)] px-4 py-2 text-base text-fg"
          >
            <AlertTriangle size={16} strokeWidth={1.75} aria-hidden className="text-danger-fg" />
            <span className="min-w-0 flex-1">{fallo}</span>
            <Button size="sm" variant="secondary" onClick={refrescarTodo}>
              Reintentar
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className={cn("min-h-0 w-full lg:flex lg:w-auto", seleccionada ? "hidden" : "flex")}>
            <Lista
              conversaciones={conversaciones}
              contadores={contadores}
              filtros={filtros}
              cambiarFiltros={cambiarFiltros}
              seleccionada={seleccionada}
              alSeleccionar={(id) => void abrir(id)}
              cargando={cargandoLista}
              catalogos={catalogos}
              refBusqueda={refBusqueda}
              alSembrar={inicial.esDesarrollo ? () => void sembrar() : null}
              sembrando={sembrando}
            />
          </div>

          <div
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col bg-page",
              seleccionada ? "flex" : "hidden lg:flex",
            )}
          >
            {hilo ? (
              <>
                <CabeceraHilo
                  hilo={hilo}
                  alVolver={() => setSeleccionada(null)}
                  alAbrirFicha={() => setFichaAbierta(true)}
                  alPosponer={(hasta) =>
                    void ejecutarAccion({ tipo: "posponer", hasta }, hasta ? "Pospuesta." : "De vuelta en la bandeja.")
                  }
                  alCerrar={() =>
                    void ejecutarAccion(
                      hilo.conversacion.estado === "closed" ? { tipo: "reabrir" } : { tipo: "cerrar" },
                      hilo.conversacion.estado === "closed" ? "Conversación reabierta." : "Conversación cerrada.",
                    )
                  }
                />
                <BarraControl
                  hilo={hilo}
                  trabajando={trabajando}
                  acciones={{
                    tomar: () => void tomarControl(),
                    devolver: (resumen) => void devolverControl(resumen),
                    pausar: (minutos) =>
                      void ejecutarAccion({ tipo: "pausar-ia", minutos }, "La IA queda en pausa."),
                    solicitar: () =>
                      void ejecutarAccion({ tipo: "solicitar-control" }, "Le avisamos a quien lo tiene."),
                    resumir,
                  }}
                />
                <Hilo hilo={hilo} cargando={cargandoHilo} alGuardarRespuesta={setBorradorRespuesta} />
                <Composer
                  key={hilo.conversacion.id}
                  hilo={hilo}
                  catalogos={catalogos}
                  enviando={enviando}
                  refTextarea={refComposer}
                  alEnviar={(texto) => void enviarMensaje(texto)}
                  alAnotar={(texto, menciones) => void anotar(texto, menciones)}
                  alTomarControl={() => void tomarControl()}
                />
              </>
            ) : cargandoHilo ? (
              <Hilo hilo={null} cargando alGuardarRespuesta={() => undefined} />
            ) : (
              <SinHiloSeleccionado
                sinLeer={contadores["sin-leer"]}
                alAbrirSiguiente={
                  conversaciones.length > 0
                    ? () => {
                        // La que más lo necesita: la primera sin leer; si no hay, la más reciente.
                        const destino = conversaciones.find((c) => c.sinLeer > 0) ?? conversaciones[0];
                        if (destino) void abrir(destino.id);
                      }
                    : null
                }
              />
            )}
          </div>

          {hilo && (
            <aside className="hidden w-[320px] shrink-0 border-l border-border bg-page min-[1440px]:block">
              <PanelContacto
                hilo={hilo}
                catalogos={catalogos}
                refEtiquetas={refEtiquetas}
                acciones={{
                  asignar: (usuarioId) =>
                    void ejecutarAccion({ tipo: "asignar", usuarioId }, "Asignación actualizada."),
                  etiquetar: (etiquetaId, poner) =>
                    void ejecutarAccion({ tipo: "etiquetar", etiquetaId, poner }),
                  crearEtiqueta,
                }}
              />
            </aside>
          )}
        </div>
      </div>

      {/* Por debajo de 1440 px la ficha es un cajón: el hilo manda. */}
      <Drawer open={fichaAbierta} onOpenChange={setFichaAbierta}>
        <DrawerContent title="Ficha del contacto" width={340}>
          {hilo && (
            <PanelContacto
              hilo={hilo}
              catalogos={catalogos}
              refEtiquetas={refEtiquetas}
              acciones={{
                asignar: (usuarioId) =>
                  void ejecutarAccion({ tipo: "asignar", usuarioId }, "Asignación actualizada."),
                etiquetar: (etiquetaId, poner) => void ejecutarAccion({ tipo: "etiquetar", etiquetaId, poner }),
                crearEtiqueta,
              }}
            />
          )}
        </DrawerContent>
      </Drawer>

      <DialogoRespuestaRapida
        texto={borradorRespuesta}
        key={borradorRespuesta ?? "sin-borrador"}
        alCerrar={() => setBorradorRespuesta(null)}
        alGuardar={async (atajo, titulo, cuerpo) => {
          try {
            const respuesta = await api.crearRespuestaRapida(atajo, titulo, cuerpo);
            setCatalogos((previos) => ({
              ...previos,
              respuestas: [respuesta, ...previos.respuestas.filter((r) => r.id !== respuesta.id)],
            }));
            toast.success(`Guardada como /${respuesta.atajo}`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "No pudimos guardarla.");
          }
        }}
      />
      </main>
    </>
  );
}
