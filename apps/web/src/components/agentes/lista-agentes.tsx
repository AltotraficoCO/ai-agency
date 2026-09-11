/**
 * Una lista de agentes: los que ya trabajan y los que se pueden contratar.
 *
 * La usan dos pantallas que no se mezclan. «Agentes de WhatsApp» son los que
 * atienden a clientes y los crea la persona con Strap (en WhatsApp no se
 * contratan agentes); «Agentes del negocio» trabajan por encargo para la
 * empresa (Webmaster, Marketing) y se contratan del catálogo.
 */
import { Plus, Sparkles } from "lucide-react";
import { EncabezadoPagina } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { TarjetaAgente, TarjetaCatalogo } from "@/components/tarjeta-agente";
import { datosDelMarco } from "@/lib/marco";
import { listarAgentes, type ResumenAgente } from "@/lib/agentes";
import { catalogoDelEspacio } from "@/lib/negocio/catalogo";

export type ClaseDeAgentes = "whatsapp" | "negocio";

const esDeWhatsapp = (tipo: string): boolean => tipo === "conversational";

/** A dónde lleva la tarjeta: al trabajo del agente, o a terminarlo si es un borrador propio. */
function destinoDe(agente: ResumenAgente): string {
  if (agente.activo || agente.catalogo) return `/agentes/${agente.id}/probar`;
  return `/agentes/${agente.id}/instrucciones`;
}

const TEXTOS: Record<
  ClaseDeAgentes,
  {
    topbar: string;
    contexto?: string;
    titulo: string;
    vacio: (activos: number, total: number) => string;
    tituloSinAgentes: string;
    textoSinAgentes: string;
    ayudaDisponibles: string;
  }
> = {
  whatsapp: {
    topbar: "Agentes",
    contexto: "WhatsApp",
    titulo: "Agentes de WhatsApp",
    vacio: (activos, total) =>
      total === 0
        ? "Los que contestan a tus clientes por WhatsApp. Los creas tú con Strap, a la medida de tu negocio."
        : `${activos} de ${total} atendiendo ahora. Contestan a tus clientes por WhatsApp.`,
    tituloSinAgentes: "Todavía nadie atiende tu WhatsApp",
    textoSinAgentes:
      "Cuéntale a Strap cómo es tu negocio y en unos minutos tendrás un agente contestando a tus clientes.",
    ayudaDisponibles: "Ya saben atender: los contratas, conectas tu WhatsApp y empiezan.",
  },
  negocio: {
    topbar: "Agentes del negocio",
    titulo: "Agentes del negocio",
    vacio: (activos, total) =>
      total === 0
        ? "Trabajan por encargo para tu empresa: mantienen tu web, preparan campañas y más."
        : `${activos} de ${total} trabajando. Les encargas tareas y las hacen ellos mismos.`,
    tituloSinAgentes: "Aún no has contratado ninguno",
    textoSinAgentes:
      "Estos agentes no hablan con tus clientes: hacen trabajo para tu empresa, como cambiar tu web o preparar campañas.",
    ayudaDisponibles: "Ya vienen construidos: los contratas, conectas lo que les falte y empiezan.",
  },
};

export async function ListaAgentes({ clase }: { clase: ClaseDeAgentes }) {
  const marco = await datosDelMarco();
  const [todos, catalogo] = await Promise.all([
    listarAgentes(marco.actual.workspaceId),
    catalogoDelEspacio(marco.actual.workspaceId),
  ]);
  const deEsta = (tipo: string) => (clase === "whatsapp" ? esDeWhatsapp(tipo) : !esDeWhatsapp(tipo));
  const agentes = todos.filter((a) => deEsta(a.tipo));
  // Solo los agentes del negocio se contratan: en WhatsApp se crean con Strap.
  const disponibles = clase === "negocio" ? catalogo.filter((f) => !f.contratado && !esDeWhatsapp(f.tipo)) : [];
  const activos = agentes.filter((a) => a.activo).length;
  const t = TEXTOS[clase];

  const acciones =
    clase === "whatsapp" ? (
      <EnlaceBoton href="/">
        <Sparkles size={16} aria-hidden />
        Crear con Strap
      </EnlaceBoton>
    ) : (
      <EnlaceBoton href="/contratar">
        <Plus size={16} aria-hidden />
        Contratar agente
      </EnlaceBoton>
    );

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo={t.topbar}
      {...(t.contexto ? { contexto: t.contexto } : {})}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
        <EncabezadoPagina titulo={t.titulo} descripcion={t.vacio(activos, agentes.length)} acciones={acciones} />

        <section aria-labelledby="trabajando" className="strappy-slide-up flex flex-col gap-4">
          <Titulo
            id="trabajando"
            texto={clase === "whatsapp" ? "Atendiendo a tus clientes" : "Trabajando para ti"}
            cuenta={agentes.length}
          />
          {agentes.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {agentes.map((agente) => (
                <TarjetaAgente
                  key={agente.id}
                  agente={{
                    id: agente.id,
                    nombre: agente.nombre,
                    catalogo: agente.catalogo,
                    estado: agente.estado,
                    modo: agente.modo,
                    activo: agente.activo,
                    avatar: agente.avatar,
                  }}
                  destino={destinoDe(agente)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="text-lg font-semibold text-fg">{t.tituloSinAgentes}</p>
              <p className="max-w-[56ch] text-base text-fg-secondary">{t.textoSinAgentes}</p>
              <EnlaceBoton href={clase === "whatsapp" ? "/" : "/contratar"} size="lg">
                {clase === "whatsapp" ? (
                  <>
                    <Sparkles size={16} aria-hidden />
                    Crear mi primer agente
                  </>
                ) : (
                  <>
                    <Plus size={16} aria-hidden />
                    Ver agentes para contratar
                  </>
                )}
              </EnlaceBoton>
            </div>
          )}
        </section>

        {disponibles.length > 0 ? (
          <section aria-labelledby="disponibles" className="strappy-slide-up flex flex-col gap-4">
            <Titulo
              id="disponibles"
              texto="Disponibles para contratar"
              cuenta={disponibles.length}
              ayuda={t.ayudaDisponibles}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {disponibles.map((ficha) => (
                <TarjetaCatalogo
                  key={ficha.slug}
                  ficha={{
                    slug: ficha.slug,
                    nombre: ficha.nombre,
                    tagline: ficha.tagline,
                    costeUsd: ficha.costeUsd,
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </MarcoApp>
  );
}

function Titulo({ id, texto, cuenta, ayuda }: { id: string; texto: string; cuenta: number; ayuda?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold text-fg">
        {texto}
        <span className="tnum rounded-full bg-hover px-2 py-0.5 text-2xs font-medium text-fg-muted">{cuenta}</span>
      </h2>
      {ayuda ? <p className="text-sm text-fg-muted">{ayuda}</p> : null}
    </div>
  );
}
