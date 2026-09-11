import { PaginaVacia } from "../pagina-vacia";

export const metadata = { title: "Conocimiento" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Conocimiento"
      encabezado="Tu agente aún no sabe nada de tu negocio"
      descripcion="Cuéntale a Strap tu catálogo, tus precios o la dirección de tu web y tu agente responderá con información real en lugar de inventar."
      accion={{ etiqueta: "Enseñarle mi negocio", href: "/" }}
      accionSecundaria={{ etiqueta: "Ver mis agentes", href: "/agentes" }}
    />
  );
}
