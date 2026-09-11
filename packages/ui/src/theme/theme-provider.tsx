"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * El tema oscuro de plastilina es la base (`:root`); el de día se activa con la
 * clase `.light`. Se arranca en oscuro: es el que eligió el producto, y quien
 * prefiera el día lo tiene a un clic en el menú.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      value={{ light: "light", dark: "dark" }}
      storageKey="strappy-tema"
    >
      {children}
    </NextThemesProvider>
  );
}
