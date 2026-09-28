"use client";

import * as React from "react";
import type { Resultado } from "@/lib/negocio/acciones";

/**
 * El texto del encargo y su envío. Si sale bien, la caja se vacía y
 * `alEncargar` hace lo demás (soltar la selección, refrescar).
 */
export function useEncargar(encargar: (datos: FormData) => Promise<Resultado>, alEncargar: () => void) {
  const [texto, setTexto] = React.useState("");

  const [estado, enviar, pendiente] = React.useActionState<Resultado | null, FormData>(
    async (_previo, datos) => {
      const resultado = await encargar(datos);
      if (resultado.ok) {
        setTexto("");
        alEncargar();
      }
      return resultado;
    },
    null,
  );

  return { texto, setTexto, estado, enviar, pendiente };
}
