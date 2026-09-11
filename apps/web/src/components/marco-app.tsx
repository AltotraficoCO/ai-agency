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
import { AppShell, MenuMovil, Sidebar, Topbar, rutas, todosLosDestinos, type Ruta } from "@strappy/ui";

export interface MarcoAppProps {
  usuario: { nombre: string; correo: string; avatar?: string };
  creditos: { consumidos: number; total: number; renovacion: string };
  pendientes?: number;
  titulo: React.ReactNode;
  contexto?: React.ReactNode;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * De la ruta real al destino del menú. `/agentes/x/probar` sigue siendo Agentes
 * y `/ajustes/canales` sigue siendo Ajustes: solo cuentan las rutas que tienen
 * sitio en el menú, o una subpantalla dejaría el menú sin nada marcado.
 */
function rutaActivaDe(pathname: string): Ruta {
  const candidatas = todosLosDestinos
    .map((d) => d.href as string)
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
  const [menuAbierto, setMenuAbierto] = React.useState(false);
  const [rutaVista, setRutaVista] = React.useState(pathname);

  // Al navegar desde el menú móvil, el menú se cierra solo. Se ajusta durante el
  // render para no pintar un fotograma con el menú abierto sobre la pantalla nueva.
  if (rutaVista !== pathname) {
    setRutaVista(pathname);
    setMenuAbierto(false);
  }

  const menu = (ancho?: string) => (
    <Sidebar
      rutaActiva={rutaActivaDe(pathname)}
      usuario={usuario}
      creditos={{ ...creditos, onClick: () => router.push("/ajustes/facturacion") }}
      {...(pendientes ? { pendientes } : {})}
      linkComponent={Link}
      onUsuarioClick={() => router.push("/ajustes/cuenta")}
      {...(ancho ? { className: ancho } : {})}
    />
  );

  return (
    <AppShell
      nav={menu()}
      topbar={
        <Topbar
          inicio={
            <MenuMovil abierto={menuAbierto} onAbiertoCambia={setMenuAbierto}>
              {menu("w-full")}
            </MenuMovil>
          }
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
