import { PaginaVacia } from "../pagina-vacia";

export const metadata = { title: "Contratar agente" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Contratar agente"
      encabezado="El catálogo llega enseguida"
      descripcion="Aquí podrás contratar agentes ya construidos —recepcionista, webmaster, marketing— y tenerlos atendiendo en minutos."
    />
  );
}
