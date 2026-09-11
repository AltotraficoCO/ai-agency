import { cn } from "../lib/cn";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] border-2 border-b-[3px] border-border",
        "bg-raised px-1 font-mono text-2xs text-fg-secondary",
        className,
      )}
      {...props}
    />
  );
}
