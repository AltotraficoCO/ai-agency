import { obtenerTrm } from "@strappy/core/recargas";
import { tokensDeAceptacion, validarLlaves } from "@strappy/core/wompi";
import { Badge } from "@strappy/ui";
import { FormularioCobro, FormularioLlaves } from "@/components/admin/formularios";
import { SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { exigirSuperAdmin } from "@/lib/plataforma/acceso";
import { guardarConfigCobro, guardarLlavesWompi } from "@/lib/plataforma/acciones";
import { obtenerConfigCobro, obtenerLlavesWompi } from "@/lib/plataforma/config";
import { ultimasAcciones } from "@/lib/plataforma/estadisticas";

export const metadata = { title: "Cobro · Super admin" };

const FECHA = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });
const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });

/** Solo el final: basta para reconocerla y no sirve para usarla. */
const final = (secreto: string) => (secreto ? `…${secreto.slice(-4)}` : "");

export default async function PaginaCobro() {
  await exigirSuperAdmin();
  const [config, llaves, trm, acciones] = await Promise.all([
    obtenerConfigCobro(),
    obtenerLlavesWompi(),
    obtenerTrm({ peticion: { next: { revalidate: 3600 } } as RequestInit }),
    ultimasAcciones(15),
  ]);
  const validas = validarLlaves(llaves);
  const responde = llaves.publica ? Boolean(await tokensDeAceptacion(llaves.publica)) : false;
  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "https://www.strappy.io";
  const globales = acciones.filter((a) => a.action.startsWith("cobro.") || a.action.startsWith("wompi."));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Cobro</h1>
        <p className="text-sm text-fg-secondary">Pasarela y reglas de las recargas de todos los clientes.</p>
      </header>

      <SeccionAjustes
        titulo="Wompi"
        descripcion="Las llaves se guardan cifradas y no se vuelven a mostrar. Web y worker leen estas mismas."
        accion={
          <div className="flex flex-wrap gap-2">
            <Badge tone={validas.ok ? (validas.ambiente === "produccion" ? "exito" : "info") : "aviso"}>
              {validas.ok ? (validas.ambiente === "produccion" ? "Producción" : "Pruebas") : "Incompleta"}
            </Badge>
            {llaves.publica && <Badge tone={responde ? "exito" : "aviso"}>{responde ? "Wompi responde" : "Wompi no responde"}</Badge>}
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <FormularioLlaves
            accion={guardarLlavesWompi}
            actuales={{
              publica: llaves.publica,
              privada: final(llaves.privada),
              integridad: final(llaves.integridad),
              eventos: final(llaves.eventos),
            }}
          />
          <div className="rounded-lg border border-[var(--border-subtle)] bg-inset px-3.5 py-3 text-sm">
            <p className="text-fg-secondary">URL de eventos para el panel de Wompi:</p>
            <code className="break-all text-fg">{base}/api/wompi/eventos</code>
          </div>
        </div>
      </SeccionAjustes>

      <SeccionAjustes
        titulo="Reglas de recarga"
        descripcion={trm ? `TRM de hoy: ${PESOS.format(trm)} por dólar. El cambio no se configura: sale de la Superfinanciera.` : "No se pudo consultar la TRM ahora mismo."}
      >
        <FormularioCobro config={config} accion={guardarConfigCobro} />
      </SeccionAjustes>

      <SeccionAjustes titulo="Últimos cambios">
        {globales.length === 0 ? (
          <p className="text-sm text-fg-muted">Nadie ha cambiado nada todavía: se usan los valores por defecto.</p>
        ) : (
          <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
            {globales.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <p className="text-fg">{a.action === "wompi.llaves" ? "Llaves de Wompi" : "Reglas de recarga"}</p>
                <p className="text-2xs text-fg-muted">
                  {a.actor_email} · {FECHA.format(new Date(a.created_at))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SeccionAjustes>
    </>
  );
}
