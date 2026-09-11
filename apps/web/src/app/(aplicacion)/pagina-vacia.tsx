/**
 * Estado vacío honesto.
 *
 * Cada sección que todavía no existe dice EXACTAMENTE qué va a hacer y qué
 * falta para que funcione, y ofrece el botón que lo arregla. Una pantalla vacía
 * sin salida hace pensar que el producto está roto; una con un siguiente paso,
 * no.
 */
import Link from "next/link";
import { Button, EmptyState } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";

export type AccionVacia = { etiqueta: string; href: string };

export async function PaginaVacia({
  titulo,
  contexto,
  encabezado,
  descripcion,
  accion,
  accionSecundaria,
}: {
  titulo: string;
  /** Módulo al que pertenece, p. ej. «WhatsApp». */
  contexto?: string;
  encabezado: string;
  descripcion: string;
  accion?: AccionVacia;
  accionSecundaria?: AccionVacia;
}) {
  const marco = await datosDelMarco();
  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo={titulo}
      {...(contexto ? { contexto } : {})}
    >
      <div className="grid min-h-full place-items-center px-6">
        <EmptyState
          className="strappy-slide-up"
          variant="primera-vez"
          title={encabezado}
          description={descripcion}
          action={
            accion ? (
              <Button asChild size="lg">
                <Link href={accion.href}>{accion.etiqueta}</Link>
              </Button>
            ) : undefined
          }
          secondaryAction={
            accionSecundaria ? (
              <Button asChild size="lg" variant="ghost">
                <Link href={accionSecundaria.href}>{accionSecundaria.etiqueta}</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    </MarcoApp>
  );
}
