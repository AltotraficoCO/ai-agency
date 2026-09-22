import { Info, MessageCircle, Phone } from "lucide-react";
import { Badge, Button } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { AvisoAjustes } from "@/components/negocio/seccion-ajustes";
import { canalesDeWhatsApp, configMeta, RUTA_CONECTAR, type CanalWhatsApp } from "@/lib/canales/whatsapp";
import { conexionesDeAnuncios, configDe, PLATAFORMAS_ANUNCIOS } from "@/lib/canales/anuncios";
import { SeccionAnuncios } from "@/components/canales/anuncios";
import { BotonQuitar } from "@/components/canales/boton-quitar";
import { accionEliminarNumeroWhatsApp } from "@/lib/canales/acciones";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Canales" };
export const dynamic = "force-dynamic";

/**
 * Canales.
 *
 * Una sola tarjeta grande por canal, con su estado a la vista y, mientras no
 * hay nada conectado, los tres pasos que va a vivir la persona: conectar
 * WhatsApp abre una ventana de Meta, y si no se avisa antes parece que la app
 * se fue a otra web.
 */
export default async function PaginaCanales({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const busqueda = await searchParams;
  const marco = await datosDelMarco();
  const canales = await canalesDeWhatsApp(marco.actual.workspaceId);
  const anuncios = await conexionesDeAnuncios(marco.actual.workspaceId);
  const plataformasConfiguradas = PLATAFORMAS_ANUNCIOS.filter((p) => configDe(p.plataforma) !== null).map(
    (p) => p.plataforma,
  );
  const hayConfiguracion = configMeta() !== null;
  const puedeConectar = marco.actual.rol === "owner" || marco.actual.rol === "admin";
  const resultado = texto(busqueda["whatsapp"]);
  const detalle = texto(busqueda["detalle"]);
  const resultadoAnuncios = texto(busqueda["anuncios"]);

  const conectados = canales.filter((c) => c.estadoCanal === "connected").length;

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Ajustes"
      titulo="Canales"
    >
      <DisposicionAjustes
        titulo="Canales"
        descripcion="Por dónde te escriben tus clientes, por dónde contestan tus agentes y dónde anuncias."
      >
        {resultado === "ok" && (
          <AvisoAjustes tono="exito">
            WhatsApp quedó conectado{detalle ? ` con el número ${detalle}` : ""}. Tus agentes ya pueden atender
            por ahí.
          </AvisoAjustes>
        )}
        {resultado === "error" && detalle && <AvisoAjustes tono="error">{detalle}</AvisoAjustes>}
        {resultadoAnuncios === "ok" && <AvisoAjustes tono="exito">{avisoAnuncios(detalle)}</AvisoAjustes>}
        {resultadoAnuncios === "error" && detalle && <AvisoAjustes tono="error">{detalle}</AvisoAjustes>}

        <section className="strappy-slide-up overflow-hidden rounded-xl border border-border bg-raised shadow-e1">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-whatsapp text-white shadow-e1">
              <MessageCircle size={24} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-fg">WhatsApp Business</h2>
                {conectados > 0 ? (
                  <Badge tone="exito">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    {conectados === 1 ? "Conectado" : `${conectados} números conectados`}
                  </Badge>
                ) : canales.length > 0 ? (
                  <Badge tone="aviso">Necesita revisión</Badge>
                ) : (
                  <Badge>Sin conectar</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-fg-secondary">
                Conecta el número de tu negocio y tus agentes contestarán ahí mismo, a cualquier hora.
              </p>
            </div>
            <div className="shrink-0">
              {!hayConfiguracion ? (
                <p className="max-w-56 text-2xs text-fg-muted">
                  La conexión con Meta todavía no está configurada en este servidor.
                </p>
              ) : !puedeConectar ? (
                <p className="max-w-56 text-2xs text-fg-muted">
                  Solo el propietario o un administrador pueden conectar WhatsApp.
                </p>
              ) : (
                // Formulario GET y no enlace: un <Link> precargaría la ruta y
                // abriría el diálogo de Meta sin que nadie lo pidiera.
                <form action={RUTA_CONECTAR} method="get">
                  <Button type="submit" size="lg" {...(canales.length > 0 ? { variant: "secondary" as const } : {})}>
                    {canales.length > 0 ? "Conectar otro número" : "Conectar WhatsApp"}
                  </Button>
                </form>
              )}
            </div>
          </div>

          {canales.length > 0 ? (
            <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
              {canales.map((canal) => (
                <FilaCanal key={canal.id} canal={canal} puedeQuitar={puedeConectar} />
              ))}
            </ul>
          ) : (
            <PasosConexion />
          )}

          <p className="flex items-start gap-2 border-t border-[var(--border-subtle)] bg-inset px-5 py-3 text-2xs text-fg-muted">
            <Info size={14} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
            Meta te cobra las conversaciones directamente a ti: nosotros no revendemos mensajes.
          </p>
        </section>

        <SeccionAnuncios
          conexiones={anuncios}
          configuradas={plataformasConfiguradas}
          puedeConectar={puedeConectar}
        />
      </DisposicionAjustes>
    </MarcoApp>
  );
}

const PASOS = [
  { titulo: "Pulsa Conectar WhatsApp", detalle: "Se abre una ventana segura de Meta." },
  {
    titulo: "Elige tu número",
    detalle: "Entra con la cuenta de Facebook del negocio y elige tu número de WhatsApp Business.",
  },
  { titulo: "Listo para atender", detalle: "Vuelves aquí y tus agentes ya pueden contestar." },
] as const;

function PasosConexion() {
  return (
    <ol className="grid gap-4 border-t border-[var(--border-subtle)] px-5 py-5 sm:grid-cols-3">
      {PASOS.map((paso, i) => (
        <li key={paso.titulo} className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-page text-sm font-semibold text-fg tnum">
            {i + 1}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-medium text-fg">{paso.titulo}</span>
            <span className="text-sm text-fg-muted">{paso.detalle}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const ESTADOS: Record<string, { etiqueta: string; tono: "exito" | "aviso" | "error" }> = {
  connected: { etiqueta: "Conectado", tono: "exito" },
  pending: { etiqueta: "Conectando", tono: "aviso" },
  error: { etiqueta: "Necesita revisión", tono: "error" },
  degraded: { etiqueta: "Con problemas", tono: "aviso" },
  disconnected: { etiqueta: "Desconectado", tono: "error" },
};

function FilaCanal({ canal, puedeQuitar }: { canal: CanalWhatsApp; puedeQuitar: boolean }) {
  const estado = ESTADOS[canal.estadoCanal] ?? { etiqueta: canal.estadoCanal, tono: "aviso" as const };

  return (
    <li className="flex items-start gap-3 px-5 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-hover">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-fg-secondary">
        <Phone size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-fg tnum">{canal.numero}</p>
        {canal.nombre && <p className="text-sm text-fg-secondary">{canal.nombre}</p>}
        {canal.detalle && <p className="mt-1 text-2xs text-danger-fg">{canal.detalle}</p>}
        {canal.pago === "no_payment_method" && (
          <p className="mt-1 text-2xs text-fg-muted">
            Tu cuenta de Meta no tiene método de pago: solo podrás contestar conversaciones que empiecen tus clientes.
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Badge tone={estado.tono}>{estado.etiqueta}</Badge>
        {puedeQuitar ? (
          <BotonQuitar
            accion={accionEliminarNumeroWhatsApp}
            campos={{ id: canal.id }}
            pregunta={`¿Eliminar el número ${canal.numero}? Tus agentes dejarán de atender por ahí. Las conversaciones que ya tienes se conservan.`}
          >
            Eliminar número
          </BotonQuitar>
        ) : null}
      </div>
    </li>
  );
}

/**
 * El resultado de conectar anuncios viaja como «Google Ads·3»: el nombre de la
 * plataforma y cuántas cuentas publicitarias se vieron. Decir cuántas importa
 * porque es lo único que le confirma al cliente que autorizó la cuenta que
 * quería y no otra.
 */
function avisoAnuncios(detalle: string | undefined): string {
  const [plataforma, cuantas] = (detalle ?? "").split("·");
  if (!plataforma) return "La plataforma de anuncios quedó conectada.";
  const n = Number.parseInt(cuantas ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return `${plataforma} quedó conectado.`;
  return `${plataforma} quedó conectado con ${n === 1 ? "1 cuenta publicitaria" : `${n} cuentas publicitarias`}. Tu agente de marketing ya puede revisarlas.`;
}

function texto(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
