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
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  ExternalLink,
  Globe,
  MessageCircleQuestion,
  CalendarClock,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Badge, Button, Drawer, DrawerContent, IndicadorEscribiendo, Input, Textarea, cn } from "@strappy/ui";
import { TextoStrap } from "@/components/meta/texto-strap";
import type { AprobacionVista, EncargoVista } from "@/lib/encargos/encargos";
import type { Resultado } from "@/lib/negocio/acciones";
import { PanelHistorial, type ItemHistorial, type TonoHistorial } from "@/components/conversacion/panel-historial";
import { RegistroTrabajo } from "@/components/conversacion/registro-trabajo";

const FOTO_WEBMASTER = "/agentes/webmaster-plastilina.webp";

/**
 * Lo que cambia de un agente por encargo a otro.
 *
 * La pantalla es la misma —historial, encargos, aprobaciones, registro de
 * trabajo en vivo— porque la forma de trabajar es la misma. Lo que no puede ser
 * igual son las palabras: a un agente de publicidad no se le dice «conecta tu
 * sitio web», y sus ejemplos no son cambiar el pie de página.
 */
export type OficioEncargos = {
  readonly foto: string;
  /** Lo que se lee mientras trabaja: «Trabajando en tu web…». */
  readonly trabajando: string;
  /** De qué depende para poder trabajar. */
  readonly conexion: {
    /** Cómo se nombra lo conectado: «Trabaja en misitio.com». */
    readonly conectado: (nombre: string) => string;
    readonly sinConectar: string;
    readonly aviso: (nombreAgente: string) => string;
    readonly ctaTexto: string;
    readonly ctaHref: string;
    /** Si sin ello no puede hacer absolutamente nada. */
    readonly bloquea: boolean;
  };
  readonly ejemplos: readonly string[];
  readonly placeholder: (nombreAgente: string) => string;
  readonly invitacion: string;
};

export const OFICIO_WEBMASTER: OficioEncargos = {
  foto: FOTO_WEBMASTER,
  trabajando: "Trabajando en tu web…",
  conexion: {
    conectado: (nombre) => `Trabaja en ${nombre}`,
    sinConectar: "Sin sitio conectado",
    aviso: (agente) => `Conecta tu sitio para que ${agente} pueda hacer cambios en él.`,
    ctaTexto: "Conectar mi sitio",
    ctaHref: "/ajustes/sitio",
    // Sin WordPress no hay nada que tocar: mejor decirlo antes de encargar.
    bloquea: true,
  },
  ejemplos: [
    "Cambia el teléfono del pie de página por 300 123 4567",
    "Añade un enlace a Instagram en el pie de página",
    "Crea una página de contacto con un formulario",
    "Revisa si hay plugins sin actualizar",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} cambie en tu sitio?`,
  invitacion:
    "Lo hace él mismo en tu sitio, guarda una copia antes y te pide permiso en lo delicado. Verás cada paso mientras trabaja.",
};

export const OFICIO_VELOCISTA: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Midiendo tu web…",
  conexion: {
    conectado: (nombre) => `Mide ${nombre}`,
    sinConectar: "Sin sitio conectado",
    aviso: (agente) => `Conecta tu sitio para que ${agente} pueda medirlo y arreglar lo que lo frena.`,
    ctaTexto: "Conectar mi sitio",
    ctaHref: "/ajustes/sitio",
    bloquea: true,
  },
  ejemplos: [
    "Mide la velocidad de mi web y dime qué la hace lenta",
    "¿Cuánto tarda en cargar en celular?",
    "Arregla lo que puedas sin tocar el diseño",
    "Compara la velocidad de hoy con la de la semana pasada",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} mida o arregle?`,
  invitacion:
    "Mide con PageSpeed, explica en dinero y en cristiano qué frena tu web, y arregla lo que puede con tu permiso y copia previa.",
};

export const OFICIO_DISENADOR: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Dibujando…",
  conexion: {
    conectado: (nombre) => `Publica en ${nombre}`,
    sinConectar: "Sin sitio conectado",
    aviso: (agente) =>
      `Conecta tu sitio para que ${agente} tome los colores de tu marca y pueda publicar lo que dibuje. Sin él, igual te entrega las imágenes.`,
    ctaTexto: "Conectar mi sitio",
    ctaHref: "/ajustes/sitio",
    // Sin sitio dibuja igual: solo no puede publicar ni copiar la marca.
    bloquea: false,
  },
  ejemplos: [
    "Una portada para el artículo de esta semana",
    "Tres imágenes para redes sobre nuestra promoción",
    "Un banner para la página de inicio",
    "Rehaz esta imagen con los colores de la marca",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} dibuje?`,
  invitacion:
    "Dibuja con la identidad de tu sitio y te enseña el resultado antes de publicar nada.",
};

export const OFICIO_ADMINISTRATIVO: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Revisando tus cuentas…",
  conexion: {
    conectado: (nombre) => `Trabaja sobre ${nombre}`,
    sinConectar: "Sin contabilidad conectada",
    aviso: (agente) => `Conecta tu sistema de facturación para que ${agente} pueda ver tu cartera y tus facturas.`,
    ctaTexto: "Conectar contabilidad",
    ctaHref: "/ajustes/contabilidad",
    bloquea: true,
  },
  ejemplos: [
    "¿Qué facturas vencen esta semana?",
    "Recuérdale el pago a quien lleva más de 30 días",
    "Prepara la factura de este mes para el cliente X",
    "¿Cuánto tengo por cobrar?",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} gestione?`,
  invitacion:
    "Cartera, facturas, pagos y recordatorios. Emitir o cobrar siempre pasa por tu aprobación.",
};

export const OFICIO_REPORTES: OficioEncargos = {
  foto: "/agentes/strap.webp",
  trabajando: "Preparando el informe…",
  conexion: {
    conectado: (nombre) => `Lee ${nombre}`,
    sinConectar: "Sin contabilidad conectada",
    aviso: (agente) => `Conecta tu sistema de facturación para que ${agente} tenga cifras reales que contarte.`,
    ctaTexto: "Conectar contabilidad",
    ctaHref: "/ajustes/contabilidad",
    bloquea: true,
  },
  ejemplos: [
    "¿Cómo vamos este mes?",
    "Dame el informe del negocio en una página",
    "¿Quién me debe más y desde cuándo?",
    "Compara las ventas de este mes con el anterior",
  ],
  placeholder: (agente) => `¿Qué quieres que ${agente} te cuente?`,
  invitacion: "Solo lee. Te explica el negocio en una página, con las cifras de tu contabilidad.",
};

export const OFICIO_MARKETING: OficioEncargos = {
  foto: "/agentes/marketing-plastilina.webp",
  trabajando: "Revisando tus campañas…",
  conexion: {
    conectado: (nombre) => `Mira tus cuentas de ${nombre}`,
    sinConectar: "Sin plataformas conectadas",
    aviso: (agente) =>
      `Conecta Google Ads, Facebook o TikTok para que ${agente} pueda ver tus campañas. Mientras tanto puede responder con lo que sepa de tu negocio.`,
    ctaTexto: "Conectar mis plataformas",
    ctaHref: "/ajustes/canales",
    // Sin plataformas igual puede mirar y explicar qué le falta: encargar no
    // se bloquea, porque una respuesta honesta vale más que un botón apagado.
    bloquea: false,
  },
  ejemplos: [
    "¿Cómo van mis campañas esta semana?",
    "¿En qué estoy tirando el dinero?",
    "Pausa la campaña que no trae clientes",
    "Súbele el presupuesto a la que mejor funciona",
  ],
  placeholder: (agente) => `¿Qué quieres que revise ${agente}?`,
  invitacion:
    "Mira lo que gastas en anuncios, te dice qué está trayendo clientes y qué no, y te propone los cambios. Nunca mueve tu dinero sin que lo apruebes.",
};

const EN_CURSO = new Set<EncargoVista["estado"]>(["queued", "running"]);

const ETIQUETAS: Record<EncargoVista["estado"], { texto: string; tono: TonoHistorial }> = {
  queued: { texto: "En cola", tono: "neutral" },
  running: { texto: "Trabajando", tono: "ia" },
  esperando_aprobacion: { texto: "Necesita tu respuesta", tono: "aviso" },
  done: { texto: "Hecho", tono: "exito" },
  failed: { texto: "Falló", tono: "error" },
  cancelled: { texto: "Cancelado", tono: "neutral" },
};

type Acciones = {
  decidir: (aprobacionId: string, aprobada: boolean) => Promise<Resultado>;
  responder: (aprobacionId: string, respuesta: string) => Promise<Resultado>;
  eliminar: (taskId: string) => Promise<Resultado>;
};

/**
 * Un aviso de la vigilancia: lo escribe el Webmaster solo, sin que nadie se lo
 * pida. El tipo se declara aquí, y no se importa de `lib/sitio/avisos-sitio`,
 * porque ese módulo es de servidor y esta pantalla corre en el navegador.
 */
export type AvisoDelSitio = {
  id: string;
  severidad: "grave" | "aviso" | "bueno";
  titulo: string;
  cuerpo: string;
  propuesta: string | null;
};

export function EncargosWebmaster({
  nombreAgente,
  sitio,
  encargos,
  avisos = [],
  oficio = OFICIO_WEBMASTER,
  encargar,
  decidir,
  responder,
  eliminar,
  vaciar,
  programado,
}: {
  nombreAgente: string;
  /** Lo que tiene conectado: el sitio del Webmaster, las cuentas de Marketing. */
  sitio: { nombre: string; url: string } | null;
  /**
   * El trabajo que el agente repite solo. Vive en un panel lateral que se abre
   * desde la cabecera, no debajo del chat: ahí se perdía al final de la
   * conversación y parecía parte de ella.
   */
  programado?: { nodo: React.ReactNode; cuantos: number };
  encargos: EncargoVista[];
  /** Qué agente por encargo es. Por defecto, el Webmaster. */
  oficio?: OficioEncargos;
  /** Lo que el Webmaster vio al vigilar el sitio, de lo más reciente a lo más viejo. */
  avisos?: AvisoDelSitio[];
  encargar: (datos: FormData) => Promise<Resultado>;
  vaciar: () => Promise<Resultado>;
} & Acciones) {
  const router = useRouter();
  const formulario = React.useRef<HTMLFormElement>(null);
  const caja = React.useRef<HTMLTextAreaElement>(null);
  const final = React.useRef<HTMLDivElement>(null);
  const [texto, setTexto] = React.useState("");
  const [programadoAbierto, setProgramadoAbierto] = React.useState(false);
  const [aviso, setAviso] = React.useState<Resultado | null>(null);
  const [vaciando, setVaciando] = React.useState(false);
  const [seleccionado, setSeleccionado] = React.useState<string | null>(null);

  const [estado, enviar, pendiente] = React.useActionState<Resultado | null, FormData>(
    async (_previo, datos) => {
      const resultado = await encargar(datos);
      if (resultado.ok) {
        setTexto("");
        setSeleccionado(null);
        router.refresh();
      }
      return resultado;
    },
    null,
  );

  const hayEnCurso = encargos.some((e) => EN_CURSO.has(e.estado));
  const trabajando = encargos.some((e) => e.estado === "running");
  const esperaRespuesta = encargos.some((e) => e.estado === "esperando_aprobacion");

  React.useEffect(() => {
    if (!hayEnCurso) return;
    const intervalo = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(intervalo);
  }, [hayEnCurso, router]);

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
        {/* ── Quién trabaja y dónde ──────────────────────────────────────── */}
        <div className="shrink-0 border-b-2 border-[var(--border-subtle)]">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-3">
            <FotoAgente src={oficio.foto} size={44} trabajando={trabajando} />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate font-display text-base font-semibold text-fg">{nombreAgente}</p>
              {sitio ? (
                <a
                  href={sitio.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 truncate text-2xs text-fg-muted transition-colors hover:text-primary-fg"
                >
                  <Globe size={12} aria-hidden />
                  {oficio.conexion.conectado(sitio.nombre)}
                  <ExternalLink size={11} aria-hidden />
                </a>
              ) : (
                <p className="text-2xs text-warning-fg">{oficio.conexion.sinConectar}</p>
              )}
            </div>
            {trabajando ? (
              <span className="strappy-pop-in inline-flex items-center gap-2 rounded-full border-2 border-[color-mix(in_oklab,var(--brand),transparent_60%)] bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-fg">
                <IndicadorEscribiendo etiqueta={`${nombreAgente} está trabajando`} />
                {oficio.trabajando}
              </span>
            ) : esperaRespuesta ? (
              <Badge tone="aviso">
                <CircleAlert aria-hidden />
                Espera tu respuesta
              </Badge>
            ) : null}
            {programado ? (
              <Button size="sm" variant="secondary" onClick={() => setProgramadoAbierto(true)}>
                <CalendarClock size={14} aria-hidden />
                <span className="hidden sm:inline">Programado</span>
                {programado.cuantos > 0 ? (
                  <span className="rounded-full bg-primary-soft px-1.5 text-2xs font-semibold text-primary-fg tnum">
                    {programado.cuantos}
                  </span>
                ) : null}
              </Button>
            ) : null}
          </div>
        </div>

        {programado ? (
          <Drawer open={programadoAbierto} onOpenChange={setProgramadoAbierto}>
            <DrawerContent
              title="Trabajo que hace solo"
              description={`Lo que ${nombreAgente} repite sin que se lo pidas, y cuándo le toca.`}
              width={520}
            >
              {programado.nodo}
            </DrawerContent>
          </Drawer>
        ) : null}

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
              <div className="strappy-slide-up flex flex-col items-center gap-4 py-10 text-center">
                <FotoAgente src={oficio.foto} size={112} trabajando={false} />
                <div className="flex flex-col gap-1">
                  <p className="font-display text-xl font-semibold text-fg">Encárgale algo a {nombreAgente}</p>
                  <p className="max-w-[52ch] text-base text-fg-secondary">{oficio.invitacion}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {oficio.ejemplos.map((ejemplo) => (
                    <button
                      key={ejemplo}
                      type="button"
                      disabled={oficio.conexion.bloquea && !sitio}
                      onClick={() => usarEjemplo(ejemplo)}
                      className="cursor-pointer rounded-full border-2 border-border bg-raised px-3.5 py-2 text-sm text-fg-secondary shadow-e1 transition-[color,border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {ejemplo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ol className="flex flex-col gap-7">
              {encargos.map((encargo) => (
                <Encargo
                  key={encargo.id}
                  encargo={encargo}
                  nombreAgente={nombreAgente}
                  foto={oficio.foto}
                  resaltado={seleccionado === encargo.id}
                  decidir={decidir}
                  responder={responder}
                  eliminar={eliminar}
                />
              ))}
            </ol>
            <div ref={final} />
          </div>
        </div>

        {/* ── Composer ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t-2 border-[var(--border-subtle)] bg-page">
          <form ref={formulario} action={enviar} className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-4">
            <div className="flex items-end gap-2 rounded-2xl border-2 border-border bg-raised p-2 shadow-e1 transition-colors focus-within:border-[color-mix(in_oklab,var(--brand),transparent_45%)]">
              <Textarea
                ref={caja}
                name="texto"
                rows={2}
                required
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Enter envía; Mayús+Enter hace salto de línea, como en cualquier chat.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (texto.trim()) formulario.current?.requestSubmit();
                  }
                }}
                disabled={(oficio.conexion.bloquea && !sitio) || pendiente}
                placeholder={
                  sitio || !oficio.conexion.bloquea
                    ? oficio.placeholder(nombreAgente)
                    : "Conecta tu sitio para encargar cambios"
                }
                className="min-h-12 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:outline-none"
              />
              <Button
                type="submit"
                loading={pendiente}
                loadingLabel="Encargando"
                disabled={(oficio.conexion.bloquea && !sitio) || !texto.trim()}
                aria-label="Encargar"
              >
                <Send size={16} aria-hidden />
                Encargar
              </Button>
            </div>
            {estado && !estado.ok ? (
              <p className="px-1 text-sm text-danger-fg" role="alert">
                {estado.error}
              </p>
            ) : (
              <p className="px-1 text-2xs text-fg-muted">
                Enter para encargar · Mayús+Enter para otra línea. Guarda una copia antes de cada cambio.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/** La foto del Webmaster en círculo. Mientras trabaja, un aro verde late alrededor. */
/**
 * Un aviso de la vigilancia.
 *
 * Va arriba del todo y antes de los encargos porque es lo único de esta
 * pantalla que la persona no pidió: si su web está caída, eso es lo primero que
 * tiene que leer al entrar. La propuesta va en su propia línea: un aviso sin
 * «qué hago ahora» es una alarma, no un empleado.
 */
function AvisoDeVigilancia({ aviso }: { aviso: AvisoDelSitio }) {
  const tono =
    aviso.severidad === "grave"
      ? "border-danger/40 bg-danger-soft text-danger-fg"
      : aviso.severidad === "aviso"
        ? "border-warning/40 bg-warning-soft text-warning-fg"
        : "border-border bg-raised text-fg-secondary";
  const Icono = aviso.severidad === "grave" ? ShieldAlert : aviso.severidad === "aviso" ? CircleAlert : null;

  return (
    <li className={cn("strappy-slide-up flex gap-3 rounded-xl border-2 px-4 py-3", tono)}>
      {Icono && <Icono size={18} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-display text-sm font-semibold">{aviso.titulo}</p>
        <p className="text-sm text-fg-secondary">{aviso.cuerpo}</p>
        {aviso.propuesta && <p className="text-2xs text-fg-muted">{aviso.propuesta}</p>}
      </div>
    </li>
  );
}

function FotoAgente({
  src,
  size,
  trabajando,
}: {
  src: string;
  size: number;
  trabajando: boolean;
}) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {trabajando ? (
        <span
          aria-hidden
          className="absolute -inset-1 animate-ping rounded-full border-2 border-primary/60 motion-reduce:animate-none"
        />
      ) : null}
      <span
        className={cn(
          "relative size-full overflow-hidden rounded-full border-2 bg-[radial-gradient(circle_at_50%_30%,#123a3a_0%,#0b2224_75%)] shadow-e2",
          trabajando ? "border-primary" : "border-[var(--border-default)]",
        )}
      >
        <Image
          src={src}
          alt=""
          width={size * 3}
          height={size * 3}
          className="absolute left-1/2 top-[4%] h-auto w-[150%] max-w-none -translate-x-1/2"
        />
      </span>
    </span>
  );
}

function Encargo({
  encargo,
  nombreAgente,
  foto,
  resaltado,
  decidir,
  responder,
  eliminar,
}: {
  encargo: EncargoVista;
  nombreAgente: string;
  foto: string;
  resaltado: boolean;
} & Acciones) {
  const router = useRouter();
  const [borrando, setBorrando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const etiqueta = ETIQUETAS[encargo.estado];
  const enCurso = EN_CURSO.has(encargo.estado);
  // El contrato trae `pasos`; mientras el backend no los rellene llega vacío.
  const pasos = encargo.pasos ?? [];

  async function borrar() {
    if (!window.confirm("¿Eliminar este encargo del historial? Lo que ya cambió en tu sitio se queda como está.")) {
      return;
    }
    setBorrando(true);
    setError(null);
    const resultado = await eliminar(encargo.id);
    setBorrando(false);
    if (resultado.ok) router.refresh();
    else setError(resultado.error);
  }

  return (
    <li
      id={`encargo-${encargo.id}`}
      className={cn(
        "strappy-slide-up group flex scroll-mt-4 flex-col gap-3 rounded-2xl transition-[box-shadow,background-color] duration-[var(--dur-slow)]",
        resaltado && "bg-[color-mix(in_oklab,var(--brand),transparent_94%)] p-3 ring-2 ring-[color-mix(in_oklab,var(--brand),transparent_60%)]",
      )}
    >
      {/* Lo que pidió la persona */}
      <div className="flex items-start justify-end gap-2">
        {encargo.estado !== "running" && (
          <button
            type="button"
            onClick={borrar}
            disabled={borrando}
            aria-label="Eliminar encargo"
            title="Eliminar encargo"
            className="mt-1.5 grid size-7 cursor-pointer place-items-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger-fg focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-selected px-4 py-2.5 text-md text-fg shadow-e1">
          {encargo.detalle ?? encargo.titulo}
        </div>
      </div>

      {/* Lo que hace o contesta el agente */}
      <div className="flex items-start gap-2.5">
        <span className="mt-1">
          <FotoAgente src={foto} size={32} trabajando={encargo.estado === "running"} />
        </span>
        <div className="flex min-w-0 max-w-[88%] flex-1 flex-col gap-3 rounded-2xl rounded-tl-md border-2 border-[var(--border-subtle)] bg-raised px-4 py-3 shadow-e1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{nombreAgente}</span>
            <Badge tone={etiqueta.tono}>{etiqueta.texto}</Badge>
            {encargo.creditos > 0 && (
              <span className="tnum ml-auto text-2xs text-fg-muted">{encargo.creditos} créditos</span>
            )}
          </div>

          {(enCurso || pasos.length > 0) && (
            <RegistroTrabajo
              pasos={pasos}
              activo={enCurso}
              textoActivo={encargo.estado === "queued" ? "En cola, empiezo en un momento" : "Trabajando en tu web…"}
            />
          )}
          {encargo.estado === "running" && pasos.length === 0 && (
            <p className="text-2xs text-fg-muted">Suele tardar entre uno y cinco minutos. Puedes seguir con lo tuyo.</p>
          )}

          {encargo.resumen && encargo.aprobaciones.length === 0 && (
            <TextoStrap texto={encargo.resumen} />
          )}

          {/*
            Lo que el agente hizo y se puede ver: hoy, las imágenes del
            Diseñador. Sin esto entregaría «te preparé la portada» sin portada,
            y el cliente tendría que creérselo.
          */}
          {(encargo.imagenes ?? []).length > 0 && (
            <ul className="grid grid-cols-2 gap-2">
              {(encargo.imagenes ?? []).map((imagen, i) => (
                <li key={`${encargo.id}-img-${i}`} className="min-w-0">
                  <a
                    href={imagen.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-xl border-2 border-[var(--border-subtle)] transition-[box-shadow] hover:shadow-e2"
                    title="Abrir la imagen en grande"
                  >
                    {/* Es un `data:` de la evidencia, no una URL remota: el
                        optimizador de Next no puede con ella. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagen.src}
                      alt={imagen.titulo}
                      className="block h-auto w-full bg-sunken object-cover"
                      loading="lazy"
                    />
                  </a>
                  <p className="mt-1 truncate text-2xs text-fg-muted" title={imagen.titulo}>
                    {imagen.titulo}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {encargo.estado === "failed" && encargo.error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{encargo.error}</p>
          )}

          {encargo.aprobaciones.map((aprobacion) =>
            aprobacion.tipo === "pregunta" ? (
              <Pregunta key={aprobacion.id} aprobacion={aprobacion} responder={responder} onError={setError} />
            ) : (
              <Aprobacion key={aprobacion.id} aprobacion={aprobacion} decidir={decidir} onError={setError} />
            ),
          )}

          {error && (
            <p className="text-sm text-danger-fg" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function Aprobacion({
  aprobacion,
  decidir,
  onError,
}: {
  aprobacion: AprobacionVista;
  decidir: Acciones["decidir"];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [decidiendo, setDecidiendo] = React.useState<boolean | null>(null);

  async function responderCon(aprobada: boolean) {
    setDecidiendo(aprobada);
    onError(null);
    const resultado = await decidir(aprobacion.id, aprobada);
    setDecidiendo(null);
    if (resultado.ok) router.refresh();
    else onError(resultado.error);
  }

  return (
    <div className="strappy-pop-in flex flex-col gap-3 rounded-xl border-2 border-[var(--border-subtle)] border-l-4 border-l-warning bg-inset px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warning-fg">
        <ShieldAlert size={16} aria-hidden />
        Necesito tu aprobación
      </p>
      <TextoStrap texto={aprobacion.resumen} />
      <p className="text-sm text-fg-muted">Te lo pregunto porque {aprobacion.motivo}.</p>
      <div className="flex flex-wrap gap-2">
        <Button loading={decidiendo === true} disabled={decidiendo !== null} onClick={() => responderCon(true)}>
          Aprobar y seguir
        </Button>
        <Button
          variant="secondary"
          loading={decidiendo === false}
          disabled={decidiendo !== null}
          onClick={() => responderCon(false)}
        >
          No, déjalo así
        </Button>
      </div>
    </div>
  );
}

function Pregunta({
  aprobacion,
  responder,
  onError,
}: {
  aprobacion: AprobacionVista;
  responder: Acciones["responder"];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [texto, setTexto] = React.useState("");

  async function enviar(respuesta: string) {
    const limpia = respuesta.trim();
    if (!limpia) return;
    setEnviando(limpia);
    onError(null);
    const resultado = await responder(aprobacion.id, limpia);
    setEnviando(null);
    if (resultado.ok) router.refresh();
    else onError(resultado.error);
  }

  return (
    <div className="strappy-pop-in flex flex-col gap-3 rounded-xl border-2 border-[var(--border-subtle)] border-l-4 border-l-primary bg-inset px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary-fg">
        <MessageCircleQuestion size={16} aria-hidden />
        Tengo una pregunta
      </p>
      <TextoStrap texto={aprobacion.resumen} />
      {aprobacion.opciones.length > 0 && (
        <div className="flex flex-col gap-2">
          {aprobacion.opciones.map((opcion) => (
            <button
              key={opcion}
              type="button"
              disabled={enviando !== null}
              onClick={() => void enviar(opcion)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border-2 border-border bg-raised px-3 py-2.5 text-left text-base text-fg shadow-e1 transition-[border-color,background-color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:bg-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opcion}
              {enviando === opcion ? <IndicadorEscribiendo etiqueta="Enviando" /> : null}
            </button>
          ))}
        </div>
      )}
      {aprobacion.permiteTexto && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(texto);
          }}
        >
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={aprobacion.opciones.length > 0 ? "…o escribe otra respuesta" : "Escribe tu respuesta"}
            aria-label={aprobacion.resumen}
            disabled={enviando !== null}
            maxLength={1000}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={enviando !== null && enviando === texto.trim()}
            disabled={enviando !== null || !texto.trim()}
          >
            Responder
          </Button>
        </form>
      )}
    </div>
  );
}
