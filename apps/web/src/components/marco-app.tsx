"use client";

/**
 * El armazón de la aplicación.
 *
 * Dos piezas con vidas distintas:
 *  · `ArmazonApp` va en el layout y se conserva entre navegaciones: es el menú
 *    lateral. No se desmonta nunca, así que no parpadea ni «recarga».
 *  · `MarcoApp` lo pinta cada página: la barra superior (título, migas,
 *    acciones) y la zona de contenido.
 *
 * Lo que una página necesita decirle al menú —qué destino marcar cuando la URL
 * no basta, o el contador en vivo de la Bandeja— viaja por un contexto.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
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

type ContextoArmazon = {
  datos: DatosMenu;
  rutaForzada: Ruta | null;
  setRutaForzada: (ruta: Ruta | null) => void;
  setPendientesVivos: (n: number | null) => void;
};

const Armazon = React.createContext<ContextoArmazon | null>(null);

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

function usePropsDelMenu(datos: DatosMenu, rutaForzada: Ruta | null) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  return {
    pathname,
    props: {
      rutaActiva: datos.rutaActiva ?? rutaForzada ?? rutaActivaDe(pathname),
      usuario: datos.usuario,
      creditos: { ...datos.creditos, onClick: () => router.push("/ajustes/facturacion") },
      ...(datos.pendientes ? { pendientes: datos.pendientes } : {}),
      linkComponent: Link,
      onUsuarioClick: () => router.push("/ajustes/cuenta"),
    },
  };
}

/** El armazón persistente: menú lateral a la izquierda, la página a la derecha. */
export function ArmazonApp({ children, ...datosIniciales }: DatosMenu & { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [rutaForzada, setRutaForzada] = React.useState<Ruta | null>(null);
  const [pendientesVivos, setPendientesVivos] = React.useState<number | null>(null);
  const [rutaVista, setRutaVista] = React.useState(pathname);

  // Lo que forzó una página no sobrevive a la navegación: la siguiente decide.
  if (rutaVista !== pathname) {
    setRutaVista(pathname);
    setRutaForzada(null);
  }

  const datos: DatosMenu = {
    ...datosIniciales,
    ...(pendientesVivos !== null ? { pendientes: pendientesVivos } : {}),
  };
  const contexto = React.useMemo(
    () => ({ datos, rutaForzada, setRutaForzada, setPendientesVivos }),
    // `datos` cambia solo cuando cambian sus partes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datosIniciales.usuario, datosIniciales.creditos, datosIniciales.pendientes, pendientesVivos, rutaForzada],
  );

  const { props } = usePropsDelMenu(datos, rutaForzada);
  const [colapsado, alternar] = useMenuColapsado();

  return (
    <Armazon.Provider value={contexto}>
      <div className="flex h-dvh w-full overflow-hidden bg-page">
        <div className="hidden h-full md:flex">
          <Sidebar {...props} colapsado={colapsado} onAlternarColapso={alternar} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </Armazon.Provider>
  );
}

function useArmazon(): ContextoArmazon {
  const contexto = React.useContext(Armazon);
  if (!contexto) throw new Error("MarcoApp tiene que ir dentro de ArmazonApp (el layout de la aplicación).");
  return contexto;
}

/** Para pantallas con datos en vivo (la Bandeja): mantiene al día el contador del menú. */
export function usePendientesDelMenu(pendientes: number): void {
  const { setPendientesVivos } = useArmazon();
  React.useEffect(() => {
    setPendientesVivos(pendientes);
  }, [pendientes, setPendientesVivos]);
  React.useEffect(() => () => setPendientesVivos(null), [setPendientesVivos]);
}

/** El botón que abre el menú en pantallas estrechas. */
export function BotonMenuMovilApp() {
  const { datos, rutaForzada } = useArmazon();
  const { pathname, props } = usePropsDelMenu(datos, rutaForzada);
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

export interface MarcoAppProps {
  /** Se conservan por compatibilidad: el menú ya los recibe del layout. */
  usuario?: DatosMenu["usuario"];
  creditos?: DatosMenu["creditos"];
  pendientes?: number;
  /** Destino del menú a marcar cuando la URL no basta. */
  rutaActiva?: Ruta;
  titulo: React.ReactNode;
  contexto?: React.ReactNode;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}

/** La barra superior y el contenido de una página. El menú ya está en el layout. */
export function MarcoApp({ rutaActiva, titulo, contexto, acciones, children }: MarcoAppProps) {
  const { setRutaForzada } = useArmazon();
  React.useEffect(() => {
    if (rutaActiva) setRutaForzada(rutaActiva);
  }, [rutaActiva, setRutaForzada]);

  return (
    <>
      <BarraApp titulo={titulo} {...(contexto ? { contexto } : {})} {...(acciones ? { acciones } : {})} />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </>
  );
}

/** Solo la barra superior, para pantallas que montan su propio contenido (la Bandeja). */
export function BarraApp({
  titulo,
  contexto,
  acciones,
}: {
  titulo: React.ReactNode;
  contexto?: React.ReactNode;
  acciones?: React.ReactNode;
}) {
  return (
    <Topbar
      inicio={<BotonMenuMovilApp />}
      titulo={titulo}
      {...(contexto ? { contexto } : {})}
      {...(acciones ? { acciones } : {})}
    />
  );
}
