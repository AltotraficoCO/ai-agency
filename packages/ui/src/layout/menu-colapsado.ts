"use client";

import * as React from "react";

const CLAVE = "strappy-menu-colapsado";
const oyentes = new Set<() => void>();

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

function leer(): boolean {
  try {
    return window.localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

/**
 * Si el menú lateral está plegado.
 *
 * Es una preferencia de la persona, no de la pantalla: se guarda en el
 * navegador y vale igual en la Bandeja que en Ajustes. Antes la Bandeja lo
 * plegaba por su cuenta y no había forma de volver a abrirlo.
 */
export function useMenuColapsado(): readonly [boolean, () => void] {
  const colapsado = React.useSyncExternalStore(suscribir, leer, () => false);
  const alternar = React.useCallback(() => {
    try {
      window.localStorage.setItem(CLAVE, leer() ? "0" : "1");
    } catch {
      // Sin almacenamiento (modo privado estricto) el menú no recuerda nada, pero sigue funcionando en esta visita.
    }
    for (const avisar of oyentes) avisar();
  }, []);
  return [colapsado, alternar] as const;
}
