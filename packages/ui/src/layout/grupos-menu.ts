"use client";

import * as React from "react";

const CLAVE = "strappy-menu-grupos";
const oyentes = new Set<() => void>();
let ultimoCrudo: string | null = null;
let ultimoValor: Readonly<Record<string, boolean>> = {};

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

function leer(): Readonly<Record<string, boolean>> {
  let crudo: string | null = null;
  try {
    crudo = window.localStorage.getItem(CLAVE);
  } catch {
    crudo = null;
  }
  // `useSyncExternalStore` exige la misma referencia mientras no cambie nada.
  if (crudo === ultimoCrudo) return ultimoValor;
  ultimoCrudo = crudo;
  try {
    const leido = crudo ? (JSON.parse(crudo) as unknown) : {};
    ultimoValor = leido && typeof leido === "object" ? (leido as Record<string, boolean>) : {};
  } catch {
    ultimoValor = {};
  }
  return ultimoValor;
}

const SIN_ELECCION: Readonly<Record<string, boolean>> = {};

/**
 * Qué módulos del menú dejó abiertos o cerrados la persona.
 *
 * Solo se guarda lo que ella eligió. Un módulo sin elección se abre si contiene
 * la pantalla actual y se queda cerrado si no: así el menú arranca recogido y
 * aun así nunca esconde dónde estás.
 */
export function useGruposMenu(): readonly [
  Readonly<Record<string, boolean>>,
  (id: string, abierto: boolean) => void,
] {
  const elecciones = React.useSyncExternalStore(suscribir, leer, () => SIN_ELECCION);
  const elegir = React.useCallback((id: string, abierto: boolean) => {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify({ ...leer(), [id]: abierto }));
    } catch {
      // Sin almacenamiento el menú no recuerda la elección, pero sigue funcionando.
    }
    for (const avisar of oyentes) avisar();
  }, []);
  return [elecciones, elegir] as const;
}
