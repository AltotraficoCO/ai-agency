import { PaginaVacia } from "../pagina-vacia";

export const metadata = { title: "Contactos" };

// Lee el espacio y el saldo en cada visita: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaVacia
      titulo="Contactos"
      contexto="WhatsApp"
      encabezado="Todavía no hay contactos"
      descripcion="Cada persona que escriba a tu negocio se guarda aquí con lo que el agente vaya averiguando: nombre, correo, lo que pidió."
      accion={{ etiqueta: "Conectar mi WhatsApp", href: "/ajustes/canales" }}
      accionSecundaria={{ etiqueta: "Ir a la bandeja", href: "/bandeja" }}
    />
  );
}
