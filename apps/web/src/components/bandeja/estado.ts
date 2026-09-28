"use client";

/**
 * El estado de la bandeja: lo que se lee del servidor y las acciones que lo
 * cambian.
 *
 * Vive en un hook aparte solo para que `bandeja.tsx` quede en el pintado; lo
 * usa únicamente `Bandeja`, que sigue siendo el único sitio con estado de
 * verdad.
 */
import * as React from "react";
import { toast } from "@strappy/ui";
import type { Catalogos, ConversacionResumen, Etiqueta, Filtros, Hilo as HiloDatos } from "@/lib/bandeja/tipos";
import { FILTROS_INICIALES } from "@/lib/bandeja/tipos";
import { usePendientesDelMenu } from "@/components/marco-app";
import * as api from "./api";
import type { Contadores } from "./api";
import { useConexionViva } from "./vivo";

export type DatosIniciales = {
  conversaciones: ConversacionResumen[];
  contadores: Contadores;
  catalogos: Catalogos;
  workspaceId: string;
  esDesarrollo: boolean;
  usuario: { nombre: string; correo: string; avatar?: string };
  creditos: { consumidos: number; total: number; renovacion: string };
};

export function useEstadoBandeja(inicial: DatosIniciales) {
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

  const cambiarFiltros = React.useCallback((cambio: Partial<Filtros>) => {
    setFiltros((previos) => ({ ...previos, ...cambio }));
  }, []);

  return {
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
  };
}
