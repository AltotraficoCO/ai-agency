import { CircleAlert } from "lucide-react";
import { cn } from "../lib/cn";

/** El error nunca se comunica solo por color: lleva icono y texto. */
export function FieldError({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-1.5 text-sm text-danger-fg", className)}
      {...props}
    >
      <CircleAlert size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
