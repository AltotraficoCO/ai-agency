"use client";

/**
 * Encargos al Webmaster.
 *
 * Parece un chat, pero cada mensaje es un encargo: se guarda como tarea y el
 * worker lo ejecuta sobre el sitio conectado. A la izquierda, el historial de
 * encargos para volver a cualquiera; a la derecha, la conversación.
 *
 * Mientras el Webmaster trabaja se le ve trabajar: su foto late, la cabecera
 * dice «Trabajando en tu web…» y el registro de trabajo va sumando pasos en
 * vivo. La pantalla se refresca sola cada cinco segundos, porque el resultado
 * llega minutos después y nadie debería tener que recargar para verlo.
 *
 * Cuando necesita algo de la persona —aprobar un cambio delicado o elegir entre
 * opciones— la tarjeta se distingue del resto: borde de color, icono y título
 * que dicen «esto espera por ti».
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, cn } from "@strappy/ui";
import type { EquipoVista } from "@/components/conversacion/registro-trabajo";
import type { EncargoVista } from "@/lib/encargos/encargos";
import type { Resultado } from "@/lib/negocio/acciones";
import { PanelHistorial, type ItemHistorial } from "@/components/conversacion/panel-historial";
import {
  EN_CURSO,
  ETIQUETAS,
  type Acciones,
  type AvisoDelSitio,
  type ModoAgente,
  type SitioConectado,
  type TrabajoProgramado,
} from "./comun";
import { OFICIO_WEBMASTER, OFICIOS, type OficioEncargos } from "./oficios";
import { AvisoDeVigilancia } from "./aviso-de-vigilancia";
import { Bienvenida } from "./bienvenida";
import { CabeceraEncargos } from "./cabecera";
import { Composer } from "./composer";
import { Encargo } from "./encargo";
import { useEncargar } from "./use-encargar";
import { useRefrescoEnCurso } from "./use-refresco-en-curso";

export {
  OFICIO_WEBMASTER,
  OFICIO_DISENADOR,
  OFICIO_ADMINISTRATIVO,
  OFICIO_REPORTES,
  OFICIO_MARKETING,
  OFICIOS,
  type OficioEncargos,
} from "./oficios";
export type { AvisoDelSitio } from "./comun";

export function EncargosWebmaster({
  nombreAgente,
  sitio,
  encargos,
  avisos = [],
  oficio: oficioEntrada = OFICIO_WEBMASTER,
  encargar,
  decidir,
  responder,
  eliminar,
  parar,
  vaciar,
  programado,
  foto,
  equipo,
  modo,
}: {
  /** Lite o Max, para cambiarlo sin salir de la conversación. */
  modo?: ModoAgente;
  nombreAgente: string;
  /** Cara y nombre de cada agente contratado, por oficio: para el compañero que entra a ayudar. */
  equipo?: EquipoVista;
  /** La cara del agente contratado. Si no viene, la del oficio. */
  foto?: string | null;
  /** Lo que tiene conectado: el sitio del Webmaster, las cuentas de Marketing. */
  sitio: SitioConectado | null;
  /**
   * El trabajo que el agente repite solo. Vive en un panel lateral que se abre
   * desde la cabecera, no debajo del chat: ahí se perdía al final de la
   * conversación y parecía parte de ella.
   */
  programado?: TrabajoProgramado;
  encargos: EncargoVista[];
  /** Qué agente por encargo es. Por defecto, el Webmaster. */
  /** El oficio por su slug del catálogo, o el objeto entero desde el propio cliente. */
  oficio?: OficioEncargos | string;
  /** Lo que el Webmaster vio al vigilar el sitio, de lo más reciente a lo más viejo. */
  avisos?: AvisoDelSitio[];
  encargar: (datos: FormData) => Promise<Resultado>;
  vaciar: () => Promise<Resultado>;
} & Acciones) {
  const router = useRouter();
  const caja = React.useRef<HTMLTextAreaElement>(null);
  const final = React.useRef<HTMLDivElement>(null);
  const oficioBase = typeof oficioEntrada === "string" ? (OFICIOS[oficioEntrada] ?? OFICIO_WEBMASTER) : oficioEntrada;
  const oficio: OficioEncargos = foto ? { ...oficioBase, foto } : oficioBase;
  const [aviso, setAviso] = React.useState<Resultado | null>(null);
  const [vaciando, setVaciando] = React.useState(false);
  const [seleccionado, setSeleccionado] = React.useState<string | null>(null);

  const { texto, setTexto, estado, enviar, pendiente } = useEncargar(encargar, () => {
    setSeleccionado(null);
    router.refresh();
  });

  const hayEnCurso = encargos.some((e) => EN_CURSO.has(e.estado));
  const trabajando = encargos.some((e) => e.estado === "running");
  const esperaRespuesta = encargos.some((e) => e.estado === "esperando_aprobacion");

  useRefrescoEnCurso(hayEnCurso);

  React.useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth" });
  }, [encargos.length]);

  const activoId = seleccionado ?? encargos.at(-1)?.id ?? null;

  const historial: ItemHistorial[] = encargos.map((encargo) => ({
    id: encargo.id,
    titulo: encargo.titulo,
    fecha: encargo.creadoEl,
    estado: { ...ETIQUETAS[encargo.estado], vivo: encargo.estado === "running" },
  }));

  function elegirEncargo(id: string) {
    setSeleccionado(id);
    document.getElementById(`encargo-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function vaciarHistorial() {
    if (!window.confirm("¿Vaciar el historial de encargos? Los que están trabajando ahora se quedan.")) return;
    setVaciando(true);
    const resultado = await vaciar();
    setVaciando(false);
    setAviso(resultado);
    if (resultado.ok) router.refresh();
  }

  function usarEjemplo(ejemplo: string) {
    setTexto(ejemplo);
    caja.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <PanelHistorial
        titulo="Encargos"
        items={historial}
        activoId={activoId}
        onElegir={elegirEncargo}
        claveAlmacen="strappy-historial-encargos"
        vacio="Aquí aparecerán los cambios que le encargues."
        nuevo={{
          etiqueta: "Nuevo encargo",
          onClick: () => {
            setSeleccionado(null);
            final.current?.scrollIntoView({ behavior: "smooth" });
            caja.current?.focus();
          },
        }}
        {...(encargos.length > 0
          ? {
              pie: (
                <Button size="sm" variant="ghost" className="w-full" loading={vaciando} onClick={vaciarHistorial}>
                  <Trash2 size={14} aria-hidden />
                  Vaciar historial
                </Button>
              ),
            }
          : {})}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CabeceraEncargos
          nombreAgente={nombreAgente}
          oficio={oficio}
          sitio={sitio}
          trabajando={trabajando}
          esperaRespuesta={esperaRespuesta}
          modo={modo}
          programado={programado}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
            {!sitio && (
              <div className="flex flex-col gap-3 rounded-xl border-2 border-warning/40 bg-warning-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-warning-fg">{oficio.conexion.aviso(nombreAgente)}</p>
                <Button asChild size="sm" className="w-fit">
                  <Link href={oficio.conexion.ctaHref}>{oficio.conexion.ctaTexto}</Link>
                </Button>
              </div>
            )}

            {avisos.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label={`Lo que ${nombreAgente} vio en tu sitio`}>
                {avisos.map((a) => (
                  <AvisoDeVigilancia key={a.id} aviso={a} />
                ))}
              </ul>
            )}

            {aviso && (
              <p className={cn("text-sm", aviso.ok ? "text-fg-secondary" : "text-danger-fg")} role="status">
                {aviso.ok ? aviso.mensaje : aviso.error}
              </p>
            )}

            {encargos.length === 0 && (
              <Bienvenida nombreAgente={nombreAgente} oficio={oficio} sitio={sitio} usarEjemplo={usarEjemplo} />
            )}

            <ol className="flex flex-col gap-7">
              {encargos.map((encargo) => (
                <Encargo
                  key={encargo.id}
                  encargo={encargo}
                  nombreAgente={nombreAgente}
                  foto={oficio.foto}
                  textoTrabajando={oficio.trabajando}
                  resaltado={seleccionado === encargo.id}
                  decidir={decidir}
                  responder={responder}
                  eliminar={eliminar}
                  parar={parar}
                  equipo={equipo}
                />
              ))}
            </ol>
            <div ref={final} />
          </div>
        </div>

        {/* ── Composer ─────────────────────────────────────────────────────── */}
        <Composer
          nombreAgente={nombreAgente}
          oficio={oficio}
          sitio={sitio}
          caja={caja}
          texto={texto}
          setTexto={setTexto}
          estado={estado}
          enviar={enviar}
          pendiente={pendiente}
        />
      </div>
    </div>
  );
}
