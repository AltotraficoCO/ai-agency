import { cn } from "../lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `interactive` añade respuesta al puntero; úsalo solo si la tarjeta entera navega. */
  interactive?: boolean;
}

/**
 * Tarjeta de plastilina: superficie crema con grano, borde grueso y volumen.
 * Interactiva, se levanta al pasar por encima y se aplasta un poco al pulsar.
 */
export function Card({ className, interactive, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "textura rounded-xl border-2 border-[var(--border-subtle)] bg-raised shadow-e2",
        interactive &&
          cn(
            "cursor-pointer transition-[transform,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]",
            "hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--brand),transparent_60%)] hover:shadow-e3",
            "active:translate-y-0 active:scale-[0.985] active:duration-[var(--dur-instant)]",
            "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          ),
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold tracking-tight text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-fg-secondary", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t-2 border-[var(--border-subtle)] p-5", className)}
      {...props}
    />
  );
}
