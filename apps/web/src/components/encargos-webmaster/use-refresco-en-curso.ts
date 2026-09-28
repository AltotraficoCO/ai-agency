"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Mientras haya algo en marcha, la pantalla se refresca sola cada cinco
 * segundos: el resultado llega minutos después y nadie debería tener que
 * recargar para verlo.
 */
export function useRefrescoEnCurso(hayEnCurso: boolean) {
  const router = useRouter();
  React.useEffect(() => {
    if (!hayEnCurso) return;
    const intervalo = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(intervalo);
  }, [hayEnCurso, router]);
}
