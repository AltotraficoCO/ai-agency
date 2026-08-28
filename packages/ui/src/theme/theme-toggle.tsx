"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl } from "../components/segmented-control";

const opciones = [
  { value: "light", label: "Claro", icon: <Sun size={16} strokeWidth={1.75} aria-hidden /> },
  { value: "dark", label: "Oscuro", icon: <Moon size={16} strokeWidth={1.75} aria-hidden /> },
  { value: "system", label: "Sistema", icon: <Monitor size={16} strokeWidth={1.75} aria-hidden /> },
] as const;

type Opcion = (typeof opciones)[number]["value"];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [montado, setMontado] = React.useState(false);
  React.useEffect(() => setMontado(true), []);

  return (
    <SegmentedControl<Opcion>
      label="Tema de la interfaz"
      size="sm"
      options={opciones}
      value={montado ? ((theme as Opcion | undefined) ?? "system") : "system"}
      onValueChange={setTheme}
      className={className}
    />
  );
}
