import { cn } from "../lib/cn";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border",
        "bg-raised px-1 font-mono text-2xs text-fg-secondary",
        className,
      )}
      {...props}
    />
  );
}
