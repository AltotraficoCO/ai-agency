"use client";

/**
 * El armazón de la aplicación.
 *
 * Vive en el cliente porque el menú necesita saber la ruta actual y porque
 * `next/link` no se puede pasar como propiedad desde un componente de servidor.
 * Todo lo que recibe son datos planos: quién es el usuario y cuánto le queda de
 * saldo. No sabe de dónde salen.
 *
 * El menú lateral y el menú móvil se exportan sueltos para las pantallas que
 * montan su propio armazón (la Bandeja): así el menú es el mismo en todas, se
 * pliega igual y recuerda lo mismo.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  MenuMovil,
  Sidebar,
  Topbar,
  rutas,
  todosLosDestinos,
  useMenuColapsado,
  type Ruta,
} from "@strappy/ui";

type DatosMenu = {
  usuario: { nombre: string; correo: string; avatar?: string };
  creditos: { consumidos: number; total: number; renovacion: string };
  pendientes?: number;
  /** Fuerza el destino marcado cuando la URL no basta (p. ej. el detalle de un agente de WhatsApp). */
  rutaActiva?: Ruta;
};

export interface MarcoAppProps extends DatosMenu {
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

function useSidebarProps({ usuario, creditos, pendientes, rutaActiva }: DatosMenu) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  return {
    pathname,
    props: {
      rutaActiva: rutaActiva ?? rutaActivaDe(pathname),
      usuario,
      creditos: { ...creditos, onClick: () => router.push("/ajustes/facturacion") },
      ...(pendientes ? { pendientes } : {}),
      linkComponent: Link,
      onUsuarioClick: () => router.push("/ajustes/cuenta"),
    },
  };
}

/** El menú de escritorio, con su botón de plegar. */
export function MenuLateralApp(datos: DatosMenu) {
  const { props } = useSidebarProps(datos);
  const [colapsado, alternar] = useMenuColapsado();
  return <Sidebar {...props} colapsado={colapsado} onAlternarColapso={alternar} />;
}

/** El botón que abre el menú en pantallas estrechas. */
export function BotonMenuMovilApp(datos: DatosMenu) {
  const { pathname, props } = useSidebarProps(datos);
  const [abierto, setAbierto] = React.useState(false);
  const [rutaVista, setRutaVista] = React.useState(pathname);

  // Al navegar desde el menú móvil, el menú se cierra solo. Se ajusta durante el
  // render para no pintar un fotograma con el menú abierto sobre la pantalla nueva.
  if (rutaVista !== pathname) {
    setRutaVista(pathname);
    setAbierto(false);
  }

  return (
    <MenuMovil abierto={abierto} onAbiertoCambia={setAbierto}>
      <Sidebar {...props} className="w-full" />
    </MenuMovil>
  );
}

export function MarcoApp({ titulo, contexto, acciones, children, ...datos }: MarcoAppProps) {
  return (
    <AppShell
      nav={<MenuLateralApp {...datos} />}
      topbar={
        <Topbar
          inicio={<BotonMenuMovilApp {...datos} />}
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
