import { cn } from "../lib/cn";

const sizes = { sm: 14, md: 18, lg: 22 } as const;

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  size?: keyof typeof sizes;
  /** Texto para lectores de pantalla; si se omite el spinner queda oculto a la a11y. */
  label?: string;
}

export function Spinner({ size = "md", label, className, ...props }: SpinnerProps) {
  const px = sizes[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("animate-spin motion-reduce:animate-none", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.22" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
