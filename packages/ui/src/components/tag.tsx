"use client";

import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  removeLabel?: string;
}

export function Tag({ className, children, onRemove, removeLabel = "Quitar", ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-raised pl-2 text-sm text-fg-secondary",
        onRemove ? "pr-1" : "pr-2",
        className,
      )}
      {...props}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel} ${typeof children === "string" ? children : ""}`.trim()}
          className="grid size-4 place-items-center rounded-xs text-fg-muted transition-colors hover:bg-active hover:text-fg"
        >
          <X size={12} strokeWidth={2} aria-hidden />
        </button>
      )}
    </span>
  );
}
