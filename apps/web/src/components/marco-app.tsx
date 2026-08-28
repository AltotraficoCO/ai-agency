"use client";

/**
 * El armazón de la aplicación.
 *
 * Vive en el cliente porque el menú necesita saber la ruta actual y porque
 * `next/link` no se puede pasar como propiedad desde un componente de servidor.
 * Todo lo que recibe son datos planos: quién es el usuario y cuánto le queda de
 * saldo. No sabe de dónde salen.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppShell, Sidebar, Topbar, rutas, type Ruta } from "@strappy/ui";

export interface MarcoAppProps {
  usuario: { nombre: string; correo: string; avatar?: string };
  creditos: { consumidos: number; total: number; renovacion: string };
  pendientes?: number;
  titulo: React.ReactNode;
  contexto?: React.ReactNode;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}

/** De la ruta real al destino del menú. `/agentes/x/probar` sigue siendo Agentes. */
function rutaActivaDe(pathname: string): Ruta {
  const candidatas = Object.values(rutas)
    .filter((r) => r !== "/")
    .sort((a, b) => b.length - a.length);
  const encontrada = candidatas.find((r) => pathname === r || pathname.startsWith(`${r}/`));
  return (encontrada ?? rutas.inicio) as Ruta;
}

export function MarcoApp({
  usuario,
  creditos,
  pendientes,
  titulo,
  contexto,
  acciones,
  children,
}: MarcoAppProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  return (
    <AppShell
      nav={
        <Sidebar
          rutaActiva={rutaActivaDe(pathname)}
          usuario={usuario}
          creditos={creditos}
          {...(pendientes ? { pendientes } : {})}
          linkComponent={Link}
          onUsuarioClick={() => router.push("/ajustes/cuenta")}
        />
      }
      topbar={
        <Topbar
          titulo={titulo}
          {...(contexto ? { contexto } : {})}
          {...(acciones ? { acciones } : {})}
        />
      }
    >
      {children}
    </AppShell>
  );
}
