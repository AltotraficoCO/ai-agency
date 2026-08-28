"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/**
 * Lista de pestañas con subrayado de 2px que se desliza hasta la pestaña activa.
 * La posición se mide del DOM en vez de calcularse: soporta etiquetas de
 * cualquier ancho y traducciones sin ajustes manuales.
 */
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, children, ...props }, forwardedRef) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwardedRef, () => listRef.current as HTMLDivElement);
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return setIndicator(null);
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();
    const observer = new MutationObserver(measure);
    observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn("relative flex items-end gap-1 border-b border-[var(--border-subtle)]", className)}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-primary transition-[left,width] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] motion-reduce:transition-none"
        style={{
          left: indicator?.left ?? 0,
          width: indicator?.width ?? 0,
          opacity: indicator ? 1 : 0,
        }}
      />
    </TabsPrimitive.List>
  );
});

export interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  count?: number;
}

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(function TabsTrigger({ className, count, children, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-t-sm px-3 text-base font-medium text-fg-secondary",
        "transition-colors duration-[var(--dur-instant)] hover:text-fg",
        "data-[state=active]:text-fg data-[disabled]:opacity-45 data-[disabled]:pointer-events-none",
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
      {typeof count === "number" && (
        <span className="tnum rounded-full bg-hover px-1.5 text-2xs text-fg-muted">{count}</span>
      )}
    </TabsPrimitive.Trigger>
  );
});
