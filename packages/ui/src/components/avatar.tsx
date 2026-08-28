import { cn } from "../lib/cn";

const sizes = { xs: "size-5 text-2xs", sm: "size-6 text-2xs", md: "size-8 text-xs", lg: "size-10 text-base" } as const;

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string;
  size?: keyof typeof sizes;
  /** Quién es: define el color de fondo cuando no hay imagen. */
  tone?: "ia" | "humano" | "cliente" | "sistema";
  status?: "en-linea" | "ausente" | "desconectado";
}

const tones = {
  ia: "bg-primary-soft text-primary-fg",
  humano: "bg-human-soft text-human-fg",
  cliente: "bg-active text-fg",
  sistema: "bg-hover text-fg-muted",
} as const;

const statusLabels = {
  "en-linea": "En línea",
  ausente: "Ausente",
  desconectado: "Desconectado",
} as const;

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function Avatar({ name, src, size = "md", tone = "cliente", status, className, ...props }: AvatarProps) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} {...props}>
      <span
        className={cn(
          "grid place-items-center overflow-hidden rounded-full font-medium select-none",
          sizes[size],
          !src && tones[tone],
        )}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initials(name)}</span>
        )}
      </span>
      {!src && <span className="sr-only">{name}</span>}
      {status && (
        <span
          title={statusLabels[status]}
          className={cn(
            "absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-[var(--s-page)]",
            status === "en-linea" && "bg-success",
            status === "ausente" && "bg-warning",
            status === "desconectado" && "bg-[var(--border-strong)]",
          )}
        >
          <span className="sr-only">{statusLabels[status]}</span>
        </span>
      )}
    </span>
  );
}
