import Link from "next/link";
import { Badge, Button, Input } from "@strappy/ui";
import { creditosCompactos, dolares } from "@/lib/negocio/creditos";
import { exigirSuperAdmin } from "@/lib/plataforma/acceso";
import { CLIENTES_POR_PAGINA, listarClientes } from "@/lib/plataforma/clientes";

export const metadata = { title: "Clientes · Super admin" };

const FECHA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  await exigirSuperAdmin();
  const { q, pagina } = await searchParams;
  const { clientes, total, pagina: actual } = await listarClientes({
    ...(q ? { busqueda: q } : {}),
    pagina: Number(pagina) || 1,
  });
  const paginas = Math.max(1, Math.ceil(total / CLIENTES_POR_PAGINA));
  const enlace = (n: number) => `/admin/clientes?${new URLSearchParams({ ...(q ? { q } : {}), pagina: String(n) }).toString()}`;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Clientes</h1>
          <p className="text-sm text-fg-secondary">{total} espacios.</p>
        </div>
        <form className="flex items-center gap-2" role="search">
          <Input name="q" defaultValue={q ?? ""} placeholder="Nombre o correo" aria-label="Buscar cliente" className="w-56" />
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
      </header>

      <div className="overflow-x-auto rounded-xl border border-border bg-raised">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-2xs tracking-wide text-fg-muted uppercase">
              <th scope="col" className="px-4 py-2.5 text-left font-medium">Cliente</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Saldo</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Consumo 30 días</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Pagado</th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">Última recarga</th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  <Link href={`/admin/clientes/${c.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
                    {c.nombre}
                  </Link>
                  <span className="block text-2xs text-fg-muted">{c.correo ?? "Sin propietario"}</span>
                </th>
                <td className="px-4 py-2.5 text-right tabular-nums text-fg">{creditosCompactos(c.saldo)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-fg-secondary">{creditosCompactos(c.consumido30)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-fg">{dolares(c.recargadoUsd)}</td>
                <td className="px-4 py-2.5 text-fg-secondary">
                  {c.ultimaRecarga ? FECHA.format(new Date(c.ultimaRecarga)) : "Nunca"}
                  {c.automatica && <span className="block text-2xs text-fg-muted">Automática encendida</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={c.estado === "active" ? "exito" : "aviso"}>
                    {c.estado === "active" ? "Activa" : "Suspendida"}
                  </Badge>
                </td>
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                  Ningún cliente coincide.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-between text-sm">
          {actual > 1 ? <Link href={enlace(actual - 1)} className="underline">Anterior</Link> : <span />}
          <span className="text-fg-muted">Página {actual} de {paginas}</span>
          {actual < paginas ? <Link href={enlace(actual + 1)} className="underline">Siguiente</Link> : <span />}
        </nav>
      )}
    </>
  );
}
