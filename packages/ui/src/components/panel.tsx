import { cn } from "../lib/cn";

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Región de página con cabecera fija y cuerpo desplazable. */
export function Panel({ title, description, actions, className, children, ...props }: PanelProps) {
  return (
    <section
      className={cn("textura flex min-h-0 flex-col rounded-xl border-2 border-[var(--border-subtle)] bg-raised shadow-e2", className)}
      {...props}
    >
      {(title || actions) && (
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4">
          <div className="flex min-w-0 flex-col">
            {title && <h2 className="truncate text-base font-semibold text-fg">{title}</h2>}
            {description && <p className="truncate text-sm text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </section>
  );
}
