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
import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  PanelRight,
  RefreshCw,
  RotateCcw,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Modal,
  ModalContent,
  Textarea,
  toast,
  cn,
} from "@strappy/ui";
import type { Catalogos, ConversacionResumen, Etiqueta, Filtros, Hilo as HiloDatos } from "@/lib/bandeja/tipos";
import { FILTROS_INICIALES } from "@/lib/bandeja/tipos";
import { BarraApp, usePendientesDelMenu } from "@/components/marco-app";
import * as api from "./api";
import type { Contadores } from "./api";
import { BarraControl } from "./barra-control";
import { Composer } from "./composer";
import { Hilo, SinHiloSeleccionado } from "./hilo";
import { Lista } from "./lista";
import { PanelContacto } from "./panel-contacto";
import { instanteRelativo, mananaALas } from "./formato";
import { useConexionViva, type EstadoConexion } from "./vivo";

export type DatosIniciales = {
  conversaciones: ConversacionResumen[];
  contadores: Contadores;
  catalogos: Catalogos;
  workspaceId: string;
  esDesarrollo: boolean;
  usuario: { nombre: string; correo: string; avatar?: string };
  creditos: { consumidos: number; total: number; renovacion: string };
};

export function Bandeja({ inicial }: { inicial: DatosIniciales }) {
  const [catalogos, setCatalogos] = React.useState(inicial.catalogos);
  const [filtros, setFiltros] = React.useState<Filtros>(FILTROS_INICIALES);
  const [conversaciones, setConversaciones] = React.useState(inicial.conversaciones);
  const [contadores, setContadores] = React.useState(inicial.contadores);
  usePendientesDelMenu(contadores["sin-leer"] ?? 0);
  const [cargandoLista, setCargandoLista] = React.useState(false);
  const [seleccionada, setSeleccionada] = React.useState<string | null>(null);
  const [hilo, setHilo] = React.useState<HiloDatos | null>(null);
  const [cargandoHilo, setCargandoHilo] = React.useState(false);
  const [trabajando, setTrabajando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [fallo, setFallo] = React.useState<string | null>(null);
  const [sembrando, setSembrando] = React.useState(false);
  const [fichaAbierta, setFichaAbierta] = React.useState(false);
  const [borradorRespuesta, setBorradorRespuesta] = React.useState<string | null>(null);

  const refBusqueda = React.useRef<HTMLInputElement>(null);
  const refComposer = React.useRef<HTMLTextAreaElement>(null);
  const refEtiquetas = React.useRef<HTMLButtonElement>(null);
  // Espejos de lo seleccionado y de los filtros para las funciones que viven
  // fuera del render (temporizadores, tiempo real): sin ellos, cada refresco
  // recrearía las suscripciones. Se sincronizan en un efecto porque escribir un
  // ref durante el render rompe el pintado concurrente de React.
  const seleccionadaRef = React.useRef<string | null>(null);
  const filtrosRef = React.useRef(filtros);
  React.useEffect(() => {
    seleccionadaRef.current = seleccionada;
    filtrosRef.current = filtros;
  }, [seleccionada, filtros]);

  // ── Lecturas ───────────────────────────────────────────────────────────────

  const refrescarLista = React.useCallback(async () => {
    try {
      const { conversaciones: filas, contadores: nuevos } = await api.traerLista(filtrosRef.current);
      setConversaciones(filas);
      setContadores(nuevos);
      setFallo(null);
    } catch (error) {
      setFallo(error instanceof Error ? error.message : "No pudimos actualizar la bandeja.");
    }
  }, []);

  const refrescarHilo = React.useCallback(async (id: string) => {
    try {
      setHilo(await api.traerHilo(id));
      setFallo(null);
    } catch (error) {
      setFallo(error instanceof Error ? error.message : "No pudimos abrir la conversación.");
    }
  }, []);

  const refrescarTodo = React.useCallback(() => {
    void refrescarLista();
    const id = seleccionadaRef.current;
    if (id) void refrescarHilo(id);
  }, [refrescarLista, refrescarHilo]);

  const { estado: conexion, reintentar } = useConexionViva({
    workspaceId: inicial.workspaceId,
    alCambiar: refrescarTodo,
  });

  // Los filtros esperan 250 ms: escribir en el buscador no debe disparar una
  // consulta por tecla.
  React.useEffect(() => {
    filtrosRef.current = filtros;
    const temporizador = window.setTimeout(() => {
      setCargandoLista(true);
      void refrescarLista().finally(() => setCargandoLista(false));
    }, 250);
    return () => window.clearTimeout(temporizador);
  }, [filtros, refrescarLista]);

  const abrir = React.useCallback(
    async (id: string) => {
      setSeleccionada(id);
      setCargandoHilo(true);
      setHilo(null);
      await refrescarHilo(id);
      setCargandoHilo(false);
      // Leída solo cuando de verdad se abrió: marcarla al pasar por encima con
      // el teclado sería mentirle al contador.
      await api.ejecutar(id, { tipo: "marcar-leida" }).catch(() => undefined);
      void refrescarLista();
    },
    [refrescarHilo, refrescarLista],
  );

  // ── Acciones ───────────────────────────────────────────────────────────────

  const conTrabajo = React.useCallback(
    async (fn: () => Promise<void>) => {
      setTrabajando(true);
      try {
        await fn();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos completar la acción.");
      } finally {
        setTrabajando(false);
      }
    },
    [],
  );

  const ejecutarAccion = React.useCallback(
    async (accion: api.Accion, exito?: string) => {
      const id = seleccionadaRef.current;
      if (!id) return;
      await conTrabajo(async () => {
        await api.ejecutar(id, accion);
        await refrescarHilo(id);
        await refrescarLista();
        if (exito) toast.success(exito);
      });
    },
    [conTrabajo, refrescarHilo, refrescarLista],
  );

  const tomarControl = React.useCallback(async () => {
    await ejecutarAccion({ tipo: "tomar-control" });
    // El foco al composer: tomar el control es decir «voy a escribir yo».
    window.setTimeout(() => refComposer.current?.focus(), 60);
  }, [ejecutarAccion]);

  const devolverControl = React.useCallback(
    async (resumen?: string) => {
      await ejecutarAccion(
        resumen ? { tipo: "devolver-control", resumen } : { tipo: "devolver-control" },
        "La IA vuelve a atender esta conversación.",
      );
    },
    [ejecutarAccion],
  );

  const alternarControl = React.useCallback(() => {
    const mando = hilo?.conversacion.mando;
    if (!mando) return;
    if (mando === "tuyo") void devolverControl();
    else if (mando !== "otro") void tomarControl();
  }, [hilo?.conversacion.mando, devolverControl, tomarControl]);

  const enviarMensaje = React.useCallback(
    async (texto: string) => {
      const id = seleccionadaRef.current;
      if (!id) return;
      setEnviando(true);
      try {
        await api.enviarMensaje(id, texto);
        await refrescarHilo(id);
        await refrescarLista();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos enviar el mensaje.");
      } finally {
        setEnviando(false);
      }
    },
    [refrescarHilo, refrescarLista],
  );

  const anotar = React.useCallback(
    async (texto: string, menciones: string[]) => {
      setEnviando(true);
      try {
        await ejecutarAccion({ tipo: "nota", texto, menciones });
      } finally {
        setEnviando(false);
      }
    },
    [ejecutarAccion],
  );

  const resumir = React.useCallback(async (): Promise<string> => {
    const id = seleccionadaRef.current;
    if (!id) return "";
    const { datos } = await api.ejecutar(id, { tipo: "resumir" });
    return typeof datos?.["resumen"] === "string" ? datos["resumen"] : "";
  }, []);

  const crearEtiqueta = React.useCallback(
    async (nombre: string, color: string): Promise<Etiqueta | null> => {
      try {
        const etiqueta = await api.crearEtiqueta(nombre, color);
        setCatalogos((previos) => ({ ...previos, etiquetas: [...previos.etiquetas, etiqueta] }));
        return etiqueta;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos crear la etiqueta.");
        return null;
      }
    },
    [],
  );

  const sembrar = React.useCallback(async () => {
    setSembrando(true);
    try {
      await api.sembrarEjemplos();
      setCatalogos(await api.traerCatalogos());
      await refrescarLista();
      toast.success("Listo: sembramos conversaciones de ejemplo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos sembrar los ejemplos.");
    } finally {
      setSembrando(false);
    }
  }, [refrescarLista]);

  // ── Teclado ────────────────────────────────────────────────────────────────

  React.useEffect(() => {
    const escribiendo = (destino: EventTarget | null): boolean => {
      const nodo = destino as HTMLElement | null;
      if (!nodo) return false;
      return (
        nodo.tagName === "INPUT" ||
        nodo.tagName === "TEXTAREA" ||
        nodo.isContentEditable === true
      );
    };

    const alPulsar = (evento: KeyboardEvent) => {
      const meta = evento.metaKey || evento.ctrlKey;

      // Alternar el mando funciona incluso escribiendo: es el atajo que se usa
      // con las manos ya en el teclado, a mitad de una frase.
      if (meta && evento.key === ".") {
        evento.preventDefault();
        alternarControl();
        return;
      }
      if (meta && (evento.key === "l" || evento.key === "L")) {
        evento.preventDefault();
        refEtiquetas.current?.click();
        return;
      }
      if (evento.key === "Escape" && escribiendo(evento.target)) {
        (evento.target as HTMLElement).blur();
        return;
      }
      if (escribiendo(evento.target)) return;

      if (evento.key === "/") {
        evento.preventDefault();
        refBusqueda.current?.focus();
        return;
      }
      if (evento.key === "j" || evento.key === "k") {
        evento.preventDefault();
        const actual = conversaciones.findIndex((c) => c.id === seleccionadaRef.current);
        const siguiente =
          evento.key === "j"
            ? Math.min(actual + 1, conversaciones.length - 1)
            : Math.max(actual - 1, 0);
        const destino = conversaciones[actual === -1 ? 0 : siguiente];
        if (destino) {
          void abrir(destino.id);
          document
            .querySelector(`[data-conversacion="${destino.id}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (evento.key === "Escape") {
        setFichaAbierta(false);
        return;
      }
    };

    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [conversaciones, abrir, alternarControl]);

  // ── Pintado ────────────────────────────────────────────────────────────────

  const cambiarFiltros = React.useCallback((cambio: Partial<Filtros>) => {
    setFiltros((previos) => ({ ...previos, ...cambio }));
  }, []);

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

function IndicadorConexion({
  estado,
  alReintentar,
}: {
  estado: EstadoConexion;
  alReintentar: () => void;
}) {
  if (estado === "vivo") {
    return (
      <Badge tone="exito" title="Los mensajes nuevos llegan solos">
        <Wifi size={12} strokeWidth={2} aria-hidden />
        En vivo
      </Badge>
    );
  }
  if (estado === "conectando") {
    return (
      <Badge tone="neutral">
        <Wifi size={12} strokeWidth={2} aria-hidden />
        Conectando…
      </Badge>
    );
  }
  if (estado === "sondeo") {
    return (
      <Badge tone="neutral" title="Esta instalación no tiene tiempo real: la bandeja se refresca sola cada 8 segundos">
        <RefreshCw size={12} strokeWidth={2} aria-hidden />
        Actualizando cada 8 s
      </Badge>
    );
  }
  return (
    <button type="button" onClick={alReintentar} title="Reintentar la conexión en vivo">
      <Badge tone="aviso">
        <WifiOff size={12} strokeWidth={2} aria-hidden />
        Sin conexión en vivo
      </Badge>
    </button>
  );
}

function CabeceraHilo({
  hilo,
  alVolver,
  alAbrirFicha,
  alPosponer,
  alCerrar,
}: {
  hilo: HiloDatos;
  alVolver: () => void;
  alAbrirFicha: () => void;
  alPosponer: (hasta: string | null) => void;
  alCerrar: () => void;
}) {
  const cerrada = hilo.conversacion.estado === "closed";
  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
      <IconButton label="Volver a la lista" size="sm" className="lg:hidden" onClick={alVolver}>
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
      {/* Pulsar en la persona abre su ficha: es lo que se busca al mirar su nombre. */}
      <button
        type="button"
        onClick={alAbrirFicha}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-hover min-[1440px]:pointer-events-none"
      >
        <Avatar size="md" tone="cliente" name={hilo.contacto.nombre} />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-fg">{hilo.contacto.nombre}</span>
          <span className="block truncate text-xs text-fg-muted">
            {hilo.contacto.telefono ? `${hilo.contacto.telefono} · ` : ""}
            {hilo.conversacion.canal.nombre}
            {hilo.conversacion.estado === "snoozed" && hilo.conversacion.pospuestaHasta && " · pospuesta"}
            {cerrada && " · cerrada"}
          </span>
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Clock size={15} strokeWidth={1.75} aria-hidden />
            Posponer
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => alPosponer(instanteRelativo(1))}>1 hora</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => alPosponer(instanteRelativo(3))}>3 horas</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => alPosponer(mananaALas())}>Mañana a las 9:00</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => alPosponer(null)}>Devolver a la bandeja</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="sm" onClick={alCerrar}>
        <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden />
        {cerrada ? "Reabrir" : "Cerrar"}
      </Button>

      <IconButton
        label="Ver la ficha del contacto"
        size="sm"
        className="min-[1440px]:hidden"
        onClick={alAbrirFicha}
      >
        <PanelRight size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
    </header>
  );
}

/** Guardar un mensaje ya enviado como respuesta rápida reutilizable. */
function DialogoRespuestaRapida({
  texto,
  alCerrar,
  alGuardar,
}: {
  texto: string | null;
  alCerrar: () => void;
  alGuardar: (atajo: string, titulo: string, cuerpo: string) => Promise<void>;
}) {
  // El estado se siembra del texto una sola vez: el diálogo se remonta con cada
  // mensaje que se quiera guardar (`key` en quien lo usa), así que no hace falta
  // un efecto que lo reinicie.
  const [atajo, setAtajo] = React.useState("");
  const [titulo, setTitulo] = React.useState(() => (texto ?? "").slice(0, 40));
  const [cuerpo, setCuerpo] = React.useState(texto ?? "");
  const [guardando, setGuardando] = React.useState(false);

  return (
    <Modal open={texto !== null} onOpenChange={(v) => (v ? undefined : alCerrar())}>
      <ModalContent
        title="Guardar como respuesta rápida"
        description="La podrás insertar escribiendo / en el composer. Usa {{contacto.nombre}} para que se rellene sola."
        footer={
          <>
            <Button variant="ghost" onClick={alCerrar}>
              Cancelar
            </Button>
            <Button
              loading={guardando}
              disabled={!atajo.trim() || !cuerpo.trim()}
              onClick={async () => {
                setGuardando(true);
                await alGuardar(atajo, titulo, cuerpo);
                setGuardando(false);
                alCerrar();
              }}
            >
              Guardar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base text-fg-muted">/</span>
            <Input
              value={atajo}
              onChange={(evento) => setAtajo(evento.target.value)}
              placeholder="atajo"
              aria-label="Atajo"
            />
            <Input
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
              placeholder="Título"
              aria-label="Título"
            />
          </div>
          <Textarea
            value={cuerpo}
            onChange={(evento) => setCuerpo(evento.target.value)}
            aria-label="Texto de la respuesta"
            rows={4}
          />
        </div>
      </ModalContent>
    </Modal>
  );
}
