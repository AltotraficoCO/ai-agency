/**
 * El panel de super admin. Fuera del grupo `(aplicacion)` a propósito: no mira un
 * espacio, sino a todos, así que su menú no lleva saldo ni destinos de un cliente.
 *
 * Esta comprobación no basta por sí sola: cada página y cada acción repiten la
 * suya, porque un layout no se vuelve a ejecutar al navegar.
 */
import { ArmazonAdmin } from "@/components/admin/armazon-admin";
import { exigirSuperAdmin } from "@/lib/plataforma/acceso";

export const metadata = { title: "Super admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const admin = await exigirSuperAdmin();
  return <ArmazonAdmin correo={admin.correo}>{children}</ArmazonAdmin>;
}
