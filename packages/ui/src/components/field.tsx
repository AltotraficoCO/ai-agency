"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";
import { HelpText } from "./help-text";
import { FieldError } from "./field-error";

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  optional?: boolean;
  help?: React.ReactNode;
  error?: React.ReactNode;
  /** Recibe los identificadores ya cableados para aria-describedby / aria-invalid. */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
  }) => React.ReactNode;
}

export function Field({ label, optional, help, error, className, children, ...props }: FieldProps) {
  const id = React.useId();
  const helpId = help ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      <Label htmlFor={id} optional={optional}>
        {label}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : (
        help && <HelpText id={helpId}>{help}</HelpText>
      )}
    </div>
  );
}
