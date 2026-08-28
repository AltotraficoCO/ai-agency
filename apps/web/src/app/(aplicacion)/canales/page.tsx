import { PaginaVacia } from "../pagina-vacia";

export const metadata = { title: "Canales" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Canales"
      encabezado="Ningún canal conectado"
      descripcion="Conecta tu WhatsApp para que el agente atienda de verdad. Mientras tanto, puedes probarlo en el simulador desde la ficha del agente."
    />
  );
}
