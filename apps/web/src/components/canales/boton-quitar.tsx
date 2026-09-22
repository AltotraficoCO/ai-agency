"use client";

/**
 * Un botón que quita algo (desconectar, eliminar) y pregunta antes.
 *
 * Es irreversible en lo que importa: la credencial se borra y Meta deja de
 * entregar mensajes. Una pregunta de una línea evita el clic accidental sin
 * montar un diálogo para lo que es una sola decisión.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@strappy/ui";
import type { ResultadoCanal } from "@/lib/canales/acciones";

export function BotonQuitar({
  accion,
  campos,
  pregunta,
  children,
}: {
  accion: (datos: FormData) => Promise<ResultadoCanal>;
  campos: Record<string, string>;
  pregunta: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!window.confirm(pregunta)) return;
    setOcupado(true);
    setError(null);
    const datos = new FormData();
    for (const [clave, valor] of Object.entries(campos)) datos.set(clave, valor);
    const resultado = await accion(datos);
    setOcupado(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="ghost" size="sm" loading={ocupado} className="text-fg-muted hover:text-danger-fg">
        {children}
      </Button>
      {error ? <p className="max-w-56 text-right text-2xs text-danger-fg">{error}</p> : null}
    </form>
  );
}
