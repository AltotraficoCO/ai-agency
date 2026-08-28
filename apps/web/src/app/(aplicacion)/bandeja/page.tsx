import { PaginaVacia } from "../pagina-vacia";

export const metadata = { title: "Bandeja" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Bandeja"
      encabezado="Aquí verás cada conversación"
      descripcion="Cuando tu agente empiece a atender, cada conversación aparecerá aquí y sabrás de un vistazo si contestó él o contestaste tú."
    />
  );
}
