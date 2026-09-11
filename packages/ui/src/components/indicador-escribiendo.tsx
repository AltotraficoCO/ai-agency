import { cn } from "../lib/cn";

export interface IndicadorEscribiendoProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Lo que anuncia el lector de pantalla, p. ej. «Espiga está escribiendo». */
  etiqueta?: string;
}

/**
 * Tres puntos que laten mientras la IA prepara la respuesta.
 *
 * Un spinner dice «espera»; esto dice «alguien está contestándote», que es lo
 * que la persona necesita sentir en un chat.
 */
export function IndicadorEscribiendo({
  etiqueta = "Escribiendo",
  className,
  ...props
}: IndicadorEscribiendoProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="strappy-escribiendo size-1.5 rounded-full bg-fg-muted"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
      <span className="sr-only">{etiqueta}</span>
    </span>
  );
}
