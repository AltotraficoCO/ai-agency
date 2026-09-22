import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, rutas } from "@strappy/ui";
import {
  EncargosWebmaster,
  OFICIO_MARKETING,
  OFICIO_WEBMASTER,
} from "@/components/encargos-webmaster";
import { EnlaceBoton } from "@/components/enlace-boton";
import { MarcoApp } from "@/components/marco-app";
import { SimuladorChat } from "@/components/simulador-chat";
import { datosDelMarco } from "@/lib/marco";
import { leerAgente } from "@/lib/agentes";
import {
  accionDecidirAprobacion,
  accionEliminarEncargo,
  accionEncargar,
  accionResponderPregunta,
  accionVaciarEncargos,
} from "@/lib/encargos/acciones";
import { agenteDeEncargos, encargosDelAgente } from "@/lib/encargos/encargos";
import { TrabajoProgramado } from "@/components/encargos/trabajo-programado";
import {
  accionCambiarEstadoProgramado,
  accionProgramar,
  accionQuitarProgramado,
} from "@/lib/programados/acciones";
import { programadosDelAgente } from "@/lib/programados/programados";
import { abrirSesion, leerHistorial, listarSesiones } from "@/lib/motor/simulador";
import { hayModeloReal } from "@/lib/motor/modelo";
import { avisosDelSitio } from "@/lib/sitio/avisos-sitio";
import { sitioDelEspacio } from "@/lib/sitio/sitio";
import { conexionesDeAnuncios } from "@/lib/canales/anuncios";

export const metadata = { title: "Probar el agente" };
export const dynamic = "force-dynamic";

export default async function PaginaProbar({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conversacion?: string | string[] }>;
}) {
  const { id } = await params;
  const { conversacion: pedida } = await searchParams;
  const conversacion = typeof pedida === "string" ? pedida : null;
  const marco = await datosDelMarco();
  const agente = await leerAgente(marco.actual.workspaceId, id);
  if (!agente) notFound();
  const seccion = seccionDe(agente.tipo);
  const nombreAgente = agente.spec.identidad.nombre || agente.nombre;

  // Los agentes por encargo no se prueban conversando: se les encarga trabajo
  // real y lo ejecuta el worker. Por el simulador solo podían escalar a una
  // persona, que es justo lo que no tienen que hacer. Ver lib/encargos.
  const porEncargo = await agenteDeEncargos(marco.actual.workspaceId, id);
  if (porEncargo) {
    const esWeb = porEncargo === "webmaster";
    const [sitio, encargos, avisos, programados] = await Promise.all([
      // Cada oficio tiene «lo suyo conectado»: el Webmaster, el WordPress;
      // Marketing, sus plataformas de anuncios. Antes Marketing no miraba
      // ninguna y decía «sin plataformas» con Google Ads conectado.
      esWeb ? sitioDelEspacio(marco.actual.workspaceId) : plataformasConectadas(marco.actual.workspaceId),
      encargosDelAgente(marco.actual.workspaceId, id),
      // Lo que vio vigilando por su cuenta: se lee aquí porque es donde la
      // persona mira cuando piensa en su web.
      esWeb ? avisosDelSitio(marco.actual.workspaceId) : Promise.resolve([]),
      // Lo que repite solo, sin que nadie se lo pida.
      programadosDelAgente(marco.actual.workspaceId, id),
    ]);
    return (
      <MarcoApp
        usuario={marco.usuario}
        creditos={marco.creditos}
        pendientes={marco.pendientes}
        contexto={<Link href={seccion.href}>{seccion.etiqueta}</Link>}
        rutaActiva={seccion.ruta}
        titulo={`Encargos · ${agente.nombre}`}
      >
        <EncargosWebmaster
          nombreAgente={nombreAgente}
          oficio={esWeb ? OFICIO_WEBMASTER : OFICIO_MARKETING}
          sitio={sitio && sitio.estado === "active" ? { nombre: sitio.nombre, url: sitio.url } : null}
          encargos={encargos}
          avisos={avisos.map((a) => ({
            id: a.id,
            severidad: a.severidad,
            titulo: a.titulo,
            cuerpo: a.cuerpo,
            propuesta: a.propuesta,
          }))}
          encargar={accionEncargar.bind(null, id)}
          decidir={accionDecidirAprobacion.bind(null, id)}
          responder={accionResponderPregunta.bind(null, id)}
          eliminar={accionEliminarEncargo.bind(null, id)}
          vaciar={accionVaciarEncargos.bind(null, id)}
          programado={{
            cuantos: programados.length,
            nodo: (
              <TrabajoProgramado
                nombreAgente={nombreAgente}
                programados={programados}
                sugerencia={SUGERENCIAS[porEncargo]}
                programar={accionProgramar.bind(null, id)}
                cambiarEstado={accionCambiarEstadoProgramado.bind(null, id)}
                quitar={accionQuitarProgramado.bind(null, id)}
                sinMarco
              />
            ),
          }}
        />
      </MarcoApp>
    );
  }

  // Cada prueba es su propia conversación. Se abre la que pide la dirección
  // (`?conversacion=`) si es de este agente; si no, la más reciente; y si no
  // hay ninguna, una nueva.
  const sesion = agente.publicado ? await abrirPrueba(marco.actual.workspaceId, id, conversacion) : null;

  const saldo = Math.max(0, marco.creditos.total - marco.creditos.consumidos);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto={<Link href={seccion.href}>{seccion.etiqueta}</Link>}
      rutaActiva={seccion.ruta}
      titulo={`Probar · ${agente.nombre}`}
      acciones={
        <EnlaceBoton size="sm" variant="ghost" href={`/agentes/${id}/instrucciones`}>
          Instrucciones
        </EnlaceBoton>
      }
    >
      {sesion ? (
        <SimuladorChat
          key={sesion.conversationId}
          agentId={id}
          conversationId={sesion.conversationId}
          historial={sesion.historial}
          sesiones={sesion.sesiones}
          nombreAgente={nombreAgente}
          fotoAgente={agente.avatar}
          saldoInicial={saldo}
          modeloDeEnsayo={!hayModeloReal()}
        />
      ) : (
        <div className="grid min-h-full place-items-center px-6">
          <EmptyState
            className="strappy-slide-up"
            title="Este agente aún no está publicado"
            description="Solo se puede probar la versión publicada. Termina sus instrucciones y publícalo: en cuanto lo hagas, podrás hablar con él aquí."
            action={
              <EnlaceBoton size="lg" href={`/agentes/${id}/instrucciones`}>
                Terminar y publicar
              </EnlaceBoton>
            }
          />
        </div>
      )}
    </MarcoApp>
  );
}

async function abrirPrueba(workspaceId: string, agentId: string, pedida: string | null) {
  let sesiones = await listarSesiones({ workspaceId, agentId });
  let conversationId = sesiones.find((s) => s.id === pedida)?.id ?? sesiones[0]?.id ?? null;
  if (!conversationId) {
    conversationId = await abrirSesion({ workspaceId, agentId });
    sesiones = await listarSesiones({ workspaceId, agentId });
  }
  const historial = await leerHistorial({ workspaceId, conversationId });
  return { conversationId, sesiones, historial };
}

/**
 * Lo primero que vale la pena dejarle programado a cada oficio.
 *
 * No es relleno: es el trabajo que un dueño de negocio pediría cada semana y se
 * le olvida. Se ofrece para rellenar, no se crea solo: programar algo gasta sus
 * créditos, y eso lo decide él.
 */
const SUGERENCIAS: Record<string, string> = {
  administrativo: "Revisa qué facturas vencen esta semana y dime lo más urgente.",
  webmaster: "Revisa que mi web esté bien y avísame si algo cambió o dejó de funcionar.",
  marketing: "Dime cómo van mis campañas y en qué estoy tirando el dinero.",
};

/** Un agente de WhatsApp vuelve a Comunicaciones; uno por encargo, a tu equipo. */
function seccionDe(tipo: string) {
  return tipo === "conversational"
    ? { href: rutas.agentesWhatsapp, etiqueta: "Agentes de WhatsApp", ruta: rutas.agentesWhatsapp }
    : { href: rutas.agentes, etiqueta: "Tu equipo", ruta: rutas.agentes };
}

/**
 * Las plataformas de anuncios activas, con la forma de «lo conectado» que
 * entiende la pantalla de encargos: «Mira tus cuentas de Google Ads y Meta».
 */
async function plataformasConectadas(
  workspaceId: string,
): Promise<{ nombre: string; url: string; estado: string } | null> {
  const activas = (await conexionesDeAnuncios(workspaceId)).filter((c) => c.estado === "active");
  if (activas.length === 0) return null;
  const nombres = activas.map((c) => c.nombre);
  const nombre =
    nombres.length === 1 ? nombres[0]! : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return { nombre, url: "/ajustes/canales", estado: "active" };
}
