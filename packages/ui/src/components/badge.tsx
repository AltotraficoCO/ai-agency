import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const badgeVariants = cva(
  // Una bolita de plastilina: redonda, con un canto oscuro abajo que le da volumen.
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-bold whitespace-nowrap shadow-[inset_0_-1.5px_0_rgb(0_0_0/0.07),inset_0_1px_0_rgb(255_255_255/0.6)] [&_svg]:size-3",
  {
    variants: {
      /* Los tonos `ia` y `humano` sostienen la tesis: el color dice quién habla. */
      tone: {
        neutral: "bg-hover text-fg-secondary",
        ia: "bg-primary-soft text-primary-fg",
        humano: "bg-human-soft text-human-fg",
        exito: "bg-success-soft text-success-fg",
        aviso: "bg-warning-soft text-warning-fg",
        error: "bg-danger-soft text-danger-fg",
        info: "bg-info-soft text-info-fg",
      },
      variant: { soft: "", outline: "bg-transparent border border-current/35" },
    },
    defaultVariants: { tone: "neutral", variant: "soft" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, variant }), className)} {...props} />;
}

export { badgeVariants };
