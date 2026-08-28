"use client";

/**
 * La conexión en vivo de la bandeja.
 *
 * REGLA: la bandeja nunca miente sobre su estado de conexión.
 *
 * Una bandeja que se quedó congelada hace ocho minutos y sigue pareciendo viva
 * es peor que una que se recarga a mano: la persona cree que nadie ha escrito y
 * el cliente lleva ocho minutos esperando. Por eso este hook distingue cuatro
 * estados y la interfaz los enseña todos:
 *
 *   · `conectando` — todavía no se sabe.
 *   · `vivo`       — suscripción abierta; los cambios llegan solos.
 *   · `sondeo`     — no hay tiempo real configurado; se refresca cada 8 s. No
 *                    es un error: es cómo funciona esta instalación.
 *   · `caido`      — HABÍA tiempo real y se cayó. Esto sí se avisa en ámbar,
 *                    con botón de reintentar, y mientras tanto se sondea.
 */
import * as React from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type EstadoConexion = "conectando" | "vivo" | "sondeo" | "caido";

const MS_SONDEO = 8_000;

/**
 * Las mismas dos variables que decide `hayAutenticacionConfigurada()`, y a
 * propósito: son las que dicen si esta instalación habla de verdad con Supabase.
 * Si aquí se aceptara cualquier otra clave, la bandeja podría suscribirse a un
 * proyecto que no es el que guarda estos mensajes y anunciar «en vivo» mientras
 * no llega nada, que es justo la mentira que este módulo existe para evitar.
 */
function credenciales(): { url: string; clave: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !clave) return null;
  return { url, clave };
}

/**
 * El nombre empieza por `use` y no por `usar` porque React lo EXIGE: sus reglas
 * de hooks se aplican por el prefijo del identificador, y `usarConexionViva`
 * dejaría de comprobarse. Es la misma excepción que `className`: una palabra que
 * pertenece a la plataforma, no al idioma del producto.
 */
export function useConexionViva(input: {
  workspaceId: string;
  /** Se llama cuando algo cambió y hay que releer. */
  alCambiar: () => void;
}): { estado: EstadoConexion; reintentar: () => void } {
  // El estado inicial se decide al montar, no en un efecto: si esta instalación
  // no tiene tiempo real, la bandeja lo dice desde el primer pintado en vez de
  // prometer «conectando…» y desdecirse.
  const [estado, setEstado] = React.useState<EstadoConexion>(() =>
    credenciales() ? "conectando" : "sondeo",
  );
  const [intento, setIntento] = React.useState(0);
  const alCambiarRef = React.useRef(input.alCambiar);
  React.useEffect(() => {
    alCambiarRef.current = input.alCambiar;
  });

  React.useEffect(() => {
    // Sin tiempo real configurado no hay nada que caerse: se sondea, y el
    // estado inicial ya lo dice.
    const config = credenciales();
    if (!config) return;

    let cancelado = false;
    let cliente: SupabaseClient | null = null;
    let canal: RealtimeChannel | null = null;

    // Import dinámico: el SDK solo se descarga si esta instalación lo usa.
    void import("@supabase/supabase-js").then(({ createClient }) => {
      if (cancelado) return;
      cliente = createClient(config.url, config.clave, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });

      const filtro = `workspace_id=eq.${input.workspaceId}`;
      canal = cliente
        .channel(`bandeja:${input.workspaceId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: filtro }, () =>
          alCambiarRef.current(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversations", filter: filtro },
          () => alCambiarRef.current(),
        )
        .subscribe((situacion) => {
          if (cancelado) return;
          if (situacion === "SUBSCRIBED") {
            setEstado("vivo");
            // Al reconectar puede haberse perdido algo: releer una vez.
            alCambiarRef.current();
            return;
          }
          if (situacion === "CHANNEL_ERROR" || situacion === "TIMED_OUT" || situacion === "CLOSED") {
            setEstado("caido");
          }
        });
    });

    return () => {
      cancelado = true;
      if (canal) void cliente?.removeChannel(canal);
    };
  }, [input.workspaceId, intento]);

  // El sondeo corre siempre que no estemos vivos, incluida la caída: la lista
  // se sigue moviendo mientras se avisa de que el tiempo real no está.
  React.useEffect(() => {
    if (estado === "vivo") return;
    const temporizador = window.setInterval(() => alCambiarRef.current(), MS_SONDEO);
    return () => window.clearInterval(temporizador);
  }, [estado]);

  const reintentar = React.useCallback(() => {
    setEstado("conectando");
    setIntento((n) => n + 1);
  }, []);

  return { estado, reintentar };
}
