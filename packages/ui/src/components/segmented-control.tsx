"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Nombre accesible del grupo; obligatorio porque no lleva etiqueta visible. */
  label: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}

/** Control segmentado con pastilla que se desliza entre opciones. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = "md",
  className,
  disabled,
}: SegmentedControlProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) return;
      setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    return () => resize.disconnect();
  }, [value, options]);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative inline-flex w-fit self-start items-center gap-0.5 rounded-md border border-border bg-inset p-0.5",
        disabled && "pointer-events-none opacity-45",
        className,
      )}
    >
      {thumb && (
        <span
          aria-hidden
          className={cn(
            "absolute rounded-[6px] bg-raised shadow-e1",
            "transition-[left,width] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] motion-reduce:transition-none",
            size === "sm" ? "h-[24px]" : "h-[30px]",
          )}
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 font-medium",
              "transition-colors duration-[var(--dur-instant)]",
              size === "sm" ? "h-[24px] text-sm" : "h-[30px] text-base",
              active ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
              focusRing,
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
