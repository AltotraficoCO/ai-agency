import { PaginaVacia } from "../../pagina-vacia";

export const metadata = { title: "Espacio de trabajo" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Espacio de trabajo"
      encabezado="Ajustes del espacio"
      descripcion="El nombre de tu empresa, su horario de atención y las políticas que el agente nunca debe contradecir."
    />
  );
}
