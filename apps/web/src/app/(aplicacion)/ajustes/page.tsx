import { redirect } from "next/navigation";

// `/ajustes` no es una pantalla: es la puerta a las cuatro que sí lo son.
export default function Ajustes() {
  redirect("/ajustes/cuenta");
}
