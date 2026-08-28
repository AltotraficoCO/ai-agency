import { PaginaVacia } from "../../pagina-vacia";

export const metadata = { title: "Facturación" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Facturación"
      encabezado="Tu plan y tus créditos"
      descripcion="Cuántos créditos te quedan, en qué se han ido y cómo ampliarlos."
    />
  );
}
