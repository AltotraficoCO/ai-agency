import { PaginaVacia } from "../../pagina-vacia";

export const metadata = { title: "Equipo" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Equipo"
      encabezado="Invita a tu equipo"
      descripcion="Quién puede ver la bandeja, quién puede publicar agentes y quién solo mira los números."
    />
  );
}
