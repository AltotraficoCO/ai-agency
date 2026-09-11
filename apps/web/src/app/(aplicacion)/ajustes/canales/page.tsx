import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { NavAjustes } from "@/components/nav-ajustes";
import { canalesDeWhatsApp, configMeta, RUTA_CONECTAR, type CanalWhatsApp } from "@/lib/canales/whatsapp";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Canales" };
export const dynamic = "force-dynamic";

export default async function PaginaCanales({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const busqueda = await searchParams;
  const marco = await datosDelMarco();
  const canales = await canalesDeWhatsApp(marco.actual.workspaceId);
  const hayConfiguracion = configMeta() !== null;
  const puedeConectar = marco.actual.rol === "owner" || marco.actual.rol === "admin";
  const resultado = texto(busqueda["whatsapp"]);
  const detalle = texto(busqueda["detalle"]);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Canales"
    >
      <NavAjustes />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        {resultado === "ok" && (
          <p role="status" className="rounded-lg bg-inset px-3 py-2 text-sm text-success-fg">
            WhatsApp quedó conectado{detalle ? ` con el número ${detalle}` : ""}. Tus agentes ya pueden atender por ahí.
          </p>
        )}
        {resultado === "error" && detalle && (
          <p role="alert" className="rounded-lg bg-inset px-3 py-2 text-sm text-danger-fg">
            {detalle}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>WhatsApp</CardTitle>
            <CardDescription>
              Conecta el número de WhatsApp Business de tu negocio para que tus agentes atiendan de verdad. Meta te
              cobra las conversaciones directamente a ti: nosotros no revendemos mensajes.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {canales.length > 0 && (
              <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {canales.map((canal) => (
                  <FilaCanal key={canal.id} canal={canal} />
                ))}
              </ul>
            )}

            {!hayConfiguracion ? (
              <p className="rounded-lg bg-inset px-3 py-2 text-2xs text-fg-muted">
                La conexión con Meta todavía no está configurada en este servidor.
              </p>
            ) : !puedeConectar ? (
              <p className="rounded-lg bg-inset px-3 py-2 text-2xs text-fg-muted">
                Solo el propietario o un administrador pueden conectar WhatsApp.
              </p>
            ) : (
              // Formulario GET y no enlace: un <Link> precargaría la ruta y
              // abriría el diálogo de Meta sin que nadie lo pidiera.
              <form action={RUTA_CONECTAR} method="get">
                <Button type="submit" {...(canales.length > 0 ? { variant: "secondary" as const } : {})}>
                  {canales.length > 0 ? "Conectar otro número" : "Conectar WhatsApp"}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </MarcoApp>
  );
}

const ESTADOS: Record<string, { etiqueta: string; aviso: boolean }> = {
  connected: { etiqueta: "Conectado", aviso: false },
  pending: { etiqueta: "Conectando", aviso: true },
  error: { etiqueta: "Necesita revisión", aviso: true },
  degraded: { etiqueta: "Con problemas", aviso: true },
  disconnected: { etiqueta: "Desconectado", aviso: true },
};

function FilaCanal({ canal }: { canal: CanalWhatsApp }) {
  const estado = ESTADOS[canal.estadoCanal] ?? { etiqueta: canal.estadoCanal, aviso: true };

  return (
    <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-base font-medium text-fg">{canal.numero}</p>
        {canal.nombre && <p className="text-sm text-fg-secondary">{canal.nombre}</p>}
        {canal.detalle && <p className="mt-1 text-2xs text-danger-fg">{canal.detalle}</p>}
        {canal.pago === "no_payment_method" && (
          <p className="mt-1 text-2xs text-fg-muted">
            Tu cuenta de Meta no tiene método de pago: solo podrás contestar conversaciones que empiecen tus clientes.
          </p>
        )}
      </div>
      {estado.aviso ? <Badge tone="aviso">{estado.etiqueta}</Badge> : <Badge>{estado.etiqueta}</Badge>}
    </li>
  );
}

function texto(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
