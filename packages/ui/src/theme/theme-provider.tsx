"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * El tema claro de plastilina es la base (`:root`); el de noche se activa con la
 * clase `.dark`. Se arranca en claro: es el que eligió el producto, y quien
 * prefiera la noche la tiene a un clic en el menú.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      value={{ light: "light", dark: "dark" }}
      storageKey="strappy-tema"
    >
      {children}
    </NextThemesProvider>
  );
}
