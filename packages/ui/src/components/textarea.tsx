"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Crece con el contenido hasta este número de líneas y después hace scroll. */
  autoGrow?: boolean;
  maxRows?: number;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow = true, maxRows = 10, rows = 3, onChange, ...props },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

  const resize = React.useCallback(() => {
    const el = innerRef.current;
    if (!el || !autoGrow) return;
    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const vertical = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) +
      parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
    el.style.height = "auto";
    const max = lineHeight * maxRows + vertical;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [autoGrow, maxRows]);

  React.useLayoutEffect(resize, [resize, props.value, props.defaultValue]);

  return (
    <textarea
      ref={innerRef}
      rows={rows}
      onChange={(event) => {
        resize();
        onChange?.(event);
      }}
      className={cn(
        "w-full resize-none rounded-md border border-border bg-inset px-[14px] py-2 text-base text-fg",
        "placeholder:text-fg-muted transition-colors duration-[var(--dur-instant)]",
        "hover:border-border-strong",
        "aria-[invalid=true]:border-danger",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        focusRing,
        className,
      )}
      {...props}
    />
  );
});
