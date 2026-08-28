import { PaginaVacia } from "../pagina-vacia";

export const metadata = { title: "Analítica" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Analítica"
      encabezado="Sin datos todavía"
      descripcion="En cuanto haya conversaciones verás cuántas resolvió el agente, cuántas pasaron a una persona y cuánto costó cada una."
    />
  );
}
