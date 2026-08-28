"use client";

import { cn } from "../lib/cn";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `Sidebar` o `SidebarRail`. */
  nav: React.ReactNode;
  topbar?: React.ReactNode;
}

/** Rejilla de la aplicación: menú fijo, barra superior fija, contenido desplazable. */
export function AppShell({ nav, topbar, className, children, ...props }: AppShellProps) {
  return (
    <div className={cn("flex h-dvh w-full overflow-hidden bg-page", className)} {...props}>
      {nav}
      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
