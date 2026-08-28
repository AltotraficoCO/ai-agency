"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * El tema oscuro es la base (`:root`); el claro se activa con la clase `.light`.
 * En la primera visita se respeta la preferencia del sistema.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      value={{ light: "light", dark: "dark" }}
      storageKey="strappy-tema"
    >
      {children}
    </NextThemesProvider>
  );
}
