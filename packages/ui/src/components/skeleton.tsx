import { cn } from "../lib/cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Forma del hueco que va a ocupar el contenido real. */
  shape?: "linea" | "bloque" | "circulo";
}

export function Skeleton({ className, shape = "bloque", ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse bg-[var(--skeleton-from)] motion-reduce:animate-none",
        shape === "linea" && "h-3 rounded-full",
        shape === "bloque" && "h-16 rounded-md",
        shape === "circulo" && "size-8 rounded-full",
        className,
      )}
      {...props}
    />
  );
}
