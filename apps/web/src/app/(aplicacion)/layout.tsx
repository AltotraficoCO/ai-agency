/**
 * Grupo de rutas de la aplicación.
 *
 * El armazón (menú y barra) lo pinta cada página, no este layout: el título y
 * las acciones de la barra son distintos en cada una, y un layout que los
 * recibiera por contexto sería más indirección que ayuda.
 */
export default function LayoutAplicacion({ children }: { children: React.ReactNode }) {
  return children;
}
