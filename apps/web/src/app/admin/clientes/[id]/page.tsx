import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@strappy/ui";
import { FormularioAjuste, FormularioEstado } from "@/components/admin/formularios";
import { SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { creditosCompactos, dolares } from "@/lib/negocio/creditos";
import { exigirSuperAdmin } from "@/lib/plataforma/acceso";
import { ajustarCreditos, cambiarEstadoCliente } from "@/lib/plataforma/acciones";
import { detalleDeCliente } from "@/lib/plataforma/clientes";
import { ultimasAcciones } from "@/lib/plataforma/estadisticas";

export const metadata = { title: "Cliente · Super admin" };

const FECHA = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });
const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ESTADOS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  declined: "Rechazada",
  voided: "Anulada",
  error: "Con error",
};

export default async function PaginaCliente({ params }: { params: Promise<{ id: string }> }) {
  await exigirSuperAdmin();
  const { id } = await params;
  if (!ES_UUID.test(id)) notFound();
  const detalle = await detalleDeCliente(id);
  if (!detalle) notFound();
  const { cliente, recargas, movimientos } = detalle;
  const acciones = await ultimasAcciones(10, id);
  const suspendido = cliente.estado === "suspended";

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/admin/clientes" className="text-sm text-fg-secondary underline-offset-2 hover:underline">
          Clientes
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{cliente.nombre}</h1>
          <Badge tone={suspendido ? "aviso" : "exito"}>{suspendido ? "Suspendida" : "Activa"}</Badge>
        </div>
        <p className="text-sm text-fg-secondary">
          {cliente.correo ?? "Sin propietario"} · desde {FECHA.format(new Date(cliente.creadoEn))}
        </p>
      </header>

      <dl className="grid gap-3 sm:grid-cols-4">
        {[
          ["Saldo", `${creditosCompactos(cliente.saldo)} créditos`],
          ["Consumo 30 días", `${creditosCompactos(cliente.consumido30)} créditos`],
          ["Pagado en total", dolares(cliente.recargadoUsd)],
          ["Recarga automática", cliente.automatica ? "Encendida" : "Apagada"],
        ].map(([etiqueta, valor]) => (
          <div key={etiqueta} className="rounded-lg border border-[var(--border-subtle)] bg-raised px-3.5 py-3">
            <dt className="text-2xs text-fg-muted">{etiqueta}</dt>
            <dd className="mt-0.5 text-base font-medium text-fg tabular-nums">{valor}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <SeccionAjustes titulo="Ajustar créditos" descripcion="Cortesías y correcciones. Queda constancia de quién y por qué.">
          <FormularioAjuste workspaceId={cliente.id} nonce={randomUUID()} accion={ajustarCreditos} />
        </SeccionAjustes>
        <SeccionAjustes
          titulo={suspendido ? "Reactivar" : "Suspender"}
          descripcion="Suspendida: sus agentes se detienen, sus usuarios no entran y no se cobra su tarjeta. Sus datos se conservan."
        >
          <FormularioEstado workspaceId={cliente.id} suspendido={suspendido} accion={cambiarEstadoCliente} />
        </SeccionAjustes>
      </div>

      <SeccionAjustes titulo="Recargas">
        {recargas.length === 0 ? (
          <p className="text-sm text-fg-muted">Aún no ha recargado.</p>
        ) : (
          <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
            {recargas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-fg">
                    {dolares(Number(r.usd_amount))} · {PESOS.format(Number(r.amount_in_cents) / 100)}
                    {r.origin === "auto" && <span className="ml-1.5 text-2xs text-fg-muted">automática</span>}
                  </p>
                  <p className="text-2xs text-fg-muted">
                    {FECHA.format(new Date(r.created_at))}
                    {r.failure_reason ? ` · ${r.failure_reason}` : ""}
                  </p>
                </div>
                <Badge tone={r.status === "approved" ? "exito" : "aviso"}>{ESTADOS[r.status] ?? r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </SeccionAjustes>

      <div className="grid gap-4 lg:grid-cols-2">
        <SeccionAjustes titulo="Últimos movimientos de créditos">
          {movimientos.length === 0 ? (
            <p className="text-sm text-fg-muted">Sin movimientos.</p>
          ) : (
            <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
              {movimientos.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-fg">{m.description ?? m.source}</p>
                    <p className="text-2xs text-fg-muted">{FECHA.format(new Date(m.created_at))}</p>
                  </div>
                  <span className="tabular-nums text-fg">
                    {m.direction === "credit" ? "+" : "−"}
                    {creditosCompactos(Number(m.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SeccionAjustes>
        <SeccionAjustes titulo="Lo hecho desde el panel">
          {acciones.length === 0 ? (
            <p className="text-sm text-fg-muted">Nadie ha tocado esta cuenta desde el panel.</p>
          ) : (
            <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
              {acciones.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <p className="text-fg">{a.action}</p>
                  <p className="text-2xs text-fg-muted">
                    {a.actor_email} · {FECHA.format(new Date(a.created_at))}
                    {typeof a.detail["motivo"] === "string" && a.detail["motivo"] ? ` · ${a.detail["motivo"]}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SeccionAjustes>
      </div>
    </>
  );
}
