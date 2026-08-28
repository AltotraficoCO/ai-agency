"use client";

import * as React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;

const itemBase = cn(
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-base text-fg",
  "outline-none transition-colors duration-[var(--dur-instant)] data-[highlighted]:bg-hover",
  "data-[disabled]:opacity-45 data-[disabled]:pointer-events-none [&_svg]:size-[18px] [&_svg]:text-fg-muted",
);

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "strappy-pop-in z-50 min-w-52 rounded-lg border border-border bg-overlay p-1 shadow-e3",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
});

export interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> {
  shortcut?: string;
  tone?: "default" | "danger";
}

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem({ className, shortcut, tone = "default", children, ...props }, ref) {
  return (
    <DropdownPrimitive.Item
      ref={ref}
      className={cn(
        itemBase,
        tone === "danger" && "text-danger-fg [&_svg]:text-danger-fg data-[highlighted]:bg-[var(--danger-soft)]",
        className,
      )}
      {...props}
    >
      {children}
      {shortcut && <span className="ml-auto font-mono text-2xs text-fg-muted">{shortcut}</span>}
    </DropdownPrimitive.Item>
  );
});

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.CheckboxItem ref={ref} className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <DropdownPrimitive.ItemIndicator className="absolute right-2">
        <Check size={16} strokeWidth={2} aria-hidden />
      </DropdownPrimitive.ItemIndicator>
    </DropdownPrimitive.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.RadioItem ref={ref} className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <DropdownPrimitive.ItemIndicator className="absolute right-2">
        <Check size={16} strokeWidth={2} aria-hidden />
      </DropdownPrimitive.ItemIndicator>
    </DropdownPrimitive.RadioItem>
  );
});

export const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <DropdownPrimitive.Label
      ref={ref}
      className={cn("px-2 py-1.5 text-2xs font-medium uppercase tracking-wide text-fg-muted", className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-[var(--border-subtle)]", className)}
      {...props}
    />
  );
});

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>
>(function DropdownMenuSubTrigger({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.SubTrigger ref={ref} className={cn(itemBase, className)} {...props}>
      {children}
      <ChevronRight size={16} strokeWidth={1.75} className="ml-auto" aria-hidden />
    </DropdownPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent
        ref={ref}
        className={cn(
          "strappy-pop-in z-50 min-w-44 rounded-lg border border-border bg-overlay p-1 shadow-e3",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
});
