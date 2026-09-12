"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * El tema oscuro de plastilina es la base del CSS (`:root`); el de día se
 * activa con la clase `.light`.
 *
 * Se ARRANCA EN CLARO, que es lo que se decidió para el producto: un software
 * de trabajo que se abre a plena luz en la oficina de un negocio, y donde el
 * verde neón sobre negro cansa en jornadas largas. Quien prefiera el oscuro lo
 * tiene a un clic, y su elección se recuerda (`strappy-tema`).
 *
 * `enableSystem` queda desactivado a propósito: con él, «por defecto» dependería
 * del ordenador de cada persona y la mitad de los clientes verían el tema que no
 * elegimos. Aquí el valor por defecto es una decisión de producto, no del
 * sistema operativo.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      value={{ light: "light", dark: "dark" }}
      storageKey="strappy-tema"
    >
      {children}
    </NextThemesProvider>
  );
}
