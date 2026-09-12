/**
 * Una lista de agentes: los que ya trabajan y los que se pueden contratar.
 *
 * La usan tres pantallas que no se mezclan:
 *  · «Agentes de WhatsApp» son los que atienden a clientes y los crea la
 *    persona con Strap (en WhatsApp no se contratan agentes);
 *  · «Tu equipo» son todos los que trabajan para la empresa, agrupados por
 *    departamento, que es como se mira una plantilla;
 *  · la pantalla de un departamento enseña solo a los suyos, y si no hay
 *    ninguno lo dice y ofrece contratar, en vez de dejar un hueco en blanco.
 */
import { Plus, Sparkles } from "lucide-react";
import { DEPARTAMENTOS, EncabezadoPagina, type DepartamentoId } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { TarjetaAgente, TarjetaCatalogo } from "@/components/tarjeta-agente";
import { datosDelMarco } from "@/lib/marco";
import { listarAgentes, type ResumenAgente } from "@/lib/agentes";
import { catalogoDelEspacio, type FichaCatalogo } from "@/lib/negocio/catalogo";
import {
  categoriasPorSlug,
  departamentoDeAgente,
  esDeWhatsapp,
} from "@/lib/negocio/departamentos";

export type ClaseDeAgentes = "whatsapp" | "negocio";

/** A dónde lleva la tarjeta: al trabajo del agente, o a terminarlo si es un borrador propio. */
function destinoDe(agente: ResumenAgente): string {
  if (agente.activo || agente.catalogo) return `/agentes/${agente.id}/probar`;
  return `/agentes/${agente.id}/instrucciones`;
}

type Textos = {
  topbar: string;
  contexto?: string;
  titulo: string;
  descripcion: (activos: number, total: number) => string;
  tituloSinAgentes: string;
  textoSinAgentes: string;
  ayudaDisponibles: string;
};

const TEXTOS_WHATSAPP: Textos = {
  topbar: "Agentes",
  contexto: "Comunicaciones",
  titulo: "Agentes de WhatsApp",
  descripcion: (activos, total) =>
    total === 0
      ? "Los que contestan a tus clientes por WhatsApp. Los creas tú con Strap, a la medida de tu negocio."
      : `${activos} de ${total} atendiendo ahora. Contestan a tus clientes por WhatsApp.`,
  tituloSinAgentes: "Todavía nadie atiende tu WhatsApp",
  textoSinAgentes:
    "Cuéntale a Strap cómo es tu negocio y en unos minutos tendrás un agente contestando a tus clientes.",
  ayudaDisponibles: "Ya saben atender: los contratas, conectas tu WhatsApp y empiezan.",
};

const TEXTOS_EQUIPO: Textos = {
  topbar: "Tu equipo",
  titulo: "Tu equipo",
  descripcion: (activos, total) =>
    total === 0
      ? "Trabajan por encargo para tu empresa: mantienen tu web, preparan campañas y más."
      : `${activos} de ${total} trabajando. Cada uno en su departamento, como una plantilla.`,
  tituloSinAgentes: "Aún no has contratado a nadie",
  textoSinAgentes:
    "Estos agentes no hablan con tus clientes: hacen trabajo para tu empresa, como cambiar tu web o preparar campañas.",
  ayudaDisponibles: "Ya vienen construidos: los contratas, conectas lo que les falte y empiezan.",
};

const TEXTOS_POR_DEPARTAMENTO: Partial<Record<DepartamentoId, Pick<Textos, "textoSinAgentes">>> = {
  marketing: {
    textoSinAgentes:
      "Un agente de marketing prepara campañas, escribe los anuncios y te cuenta qué funcionó.",
  },
  creativo: {
    textoSinAgentes:
      "Un agente creativo te prepara las piezas: imágenes para tu web y tus redes, con los colores de tu marca.",
  },
  desarrollo: {
    textoSinAgentes:
      "Un agente de desarrollo mantiene tu web: cambia páginas, gestiona plugins y avisa si algo se cae.",
  },
  financiero: {
    textoSinAgentes:
      "Un agente financiero lleva las facturas, persigue los cobros y cuadra las cuentas.",
  },
};

function textosDeDepartamento(id: DepartamentoId): Textos {
  const ficha = DEPARTAMENTOS[id];
  return {
    topbar: ficha.etiqueta,
    contexto: "Departamento",
    titulo: ficha.etiqueta,
    descripcion: (activos, total) =>
      total === 0 ? ficha.descripcion : `${activos} de ${total} trabajando. ${ficha.descripcion}`,
    tituloSinAgentes: "Aún no tienes agentes aquí",
    textoSinAgentes:
      TEXTOS_POR_DEPARTAMENTO[id]?.textoSinAgentes ??
      "Todavía no trabaja nadie en este departamento.",
    ayudaDisponibles: "Ya vienen construidos: los contratas, conectas lo que les falte y empiezan.",
  };
}

export type PropsListaAgentes =
  | { clase: ClaseDeAgentes; departamento?: undefined }
  | { departamento: DepartamentoId; clase?: undefined };

export async function ListaAgentes(props: PropsListaAgentes) {
  const vista = props.departamento ?? props.clase;
  const marco = await datosDelMarco();
  const [todos, catalogo] = await Promise.all([
    listarAgentes(marco.actual.workspaceId),
    catalogoDelEspacio(marco.actual.workspaceId),
  ]);

  const categorias = categoriasPorSlug(catalogo);
  const departamentoDe = (a: ResumenAgente) => departamentoDeAgente(a, categorias);

  const esWhatsapp = vista === "whatsapp";
  const departamento = props.departamento;

  const agentes = todos.filter((a) =>
    departamento
      ? departamentoDe(a) === departamento
      : esWhatsapp
        ? esDeWhatsapp(a.tipo)
        : !esDeWhatsapp(a.tipo),
  );

  // Solo los agentes del negocio se contratan: en WhatsApp se crean con Strap.
  const disponibles = esWhatsapp
    ? []
    : catalogo.filter(
        (f) =>
          !f.contratado &&
          !esDeWhatsapp(f.tipo) &&
          (!departamento || departamentoDeFicha(f, categorias) === departamento),
      );

  const activos = agentes.filter((a) => a.activo).length;
  const t = esWhatsapp
    ? TEXTOS_WHATSAPP
    : departamento
      ? textosDeDepartamento(departamento)
      : TEXTOS_EQUIPO;

  const acciones = esWhatsapp ? (
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

  // En «Tu equipo» los agentes se leen por departamento; en las demás pantallas
  // ya están todos filtrados y una sola rejilla dice más que varios títulos.
  const porDepartamento = !esWhatsapp && !departamento ? agrupar(agentes, departamentoDe) : null;

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo={t.topbar}
      {...(t.contexto ? { contexto: t.contexto } : {})}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
        <EncabezadoPagina
          titulo={t.titulo}
          descripcion={t.descripcion(activos, agentes.length)}
          acciones={acciones}
        />

        {agentes.length === 0 ? (
          <section aria-labelledby="trabajando" className="strappy-slide-up flex flex-col gap-4">
            <Titulo
              id="trabajando"
              texto={esWhatsapp ? "Atendiendo a tus clientes" : "Trabajando para ti"}
              cuenta={0}
            />
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="text-lg font-semibold text-fg">{t.tituloSinAgentes}</p>
              <p className="max-w-[56ch] text-base text-fg-secondary">{t.textoSinAgentes}</p>
              <EnlaceBoton href={esWhatsapp ? "/" : "/contratar"} size="lg">
                {esWhatsapp ? (
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
          </section>
        ) : porDepartamento ? (
          porDepartamento.map(([id, delArea]) => (
            <section
              key={id}
              aria-labelledby={`dep-${id}`}
              className="strappy-slide-up flex flex-col gap-4"
            >
              <Titulo
                id={`dep-${id}`}
                texto={DEPARTAMENTOS[id].etiqueta}
                cuenta={delArea.length}
                ayuda={DEPARTAMENTOS[id].descripcion}
              />
              <Rejilla agentes={delArea} />
            </section>
          ))
        ) : (
          <section aria-labelledby="trabajando" className="strappy-slide-up flex flex-col gap-4">
            <Titulo
              id="trabajando"
              texto={esWhatsapp ? "Atendiendo a tus clientes" : "Trabajando para ti"}
              cuenta={agentes.length}
            />
            <Rejilla agentes={agentes} />
          </section>
        )}

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

function departamentoDeFicha(
  ficha: FichaCatalogo,
  categorias: ReadonlyMap<string, string>,
): DepartamentoId {
  return departamentoDeAgente({ tipo: ficha.tipo, catalogo: ficha.slug }, categorias);
}

/** Los departamentos con gente, en el orden del menú. */
function agrupar(
  agentes: readonly ResumenAgente[],
  departamentoDe: (a: ResumenAgente) => DepartamentoId,
): [DepartamentoId, ResumenAgente[]][] {
  const orden: DepartamentoId[] = [
    "comunicaciones",
    "marketing",
    "creativo",
    "desarrollo",
    "financiero",
    "otros",
  ];
  const mapa = new Map<DepartamentoId, ResumenAgente[]>();
  for (const agente of agentes) {
    const id = departamentoDe(agente);
    const lista = mapa.get(id) ?? [];
    lista.push(agente);
    mapa.set(id, lista);
  }
  return orden.filter((id) => mapa.has(id)).map((id) => [id, mapa.get(id) ?? []]);
}

function Rejilla({ agentes }: { agentes: readonly ResumenAgente[] }) {
  return (
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
