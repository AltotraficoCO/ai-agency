"use client";

/**
 * Encargos al Webmaster.
 *
 * Parece un chat, pero cada mensaje es un encargo: se guarda como tarea y el
 * worker lo ejecuta sobre el sitio conectado. Mientras hay algo en cola o en
 * marcha la pantalla se refresca sola, porque el resultado llega minutos
 * después y nadie debería tener que recargar para verlo.
 *
 * Cuando el Webmaster necesita algo de la persona —aprobar un cambio delicado
 * o elegir entre opciones— la tarjeta se distingue del resto: borde de color,
 * icono y título que dicen «esto espera por ti».
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  Globe,
  MessageCircleQuestion,
  Send,
  ShieldAlert,
  Trash2,
  Wrench,
} from "lucide-react";
import { Avatar, Badge, Button, IndicadorEscribiendo, Input, Textarea, cn } from "@strappy/ui";
import type { AprobacionVista, EncargoVista } from "@/lib/encargos/encargos";
import type { Resultado } from "@/lib/negocio/acciones";

const EN_CURSO = new Set<EncargoVista["estado"]>(["queued", "running"]);

type Tono = "neutral" | "ia" | "exito" | "aviso" | "error";

const ETIQUETAS: Record<EncargoVista["estado"], { texto: string; tono: Tono; icono: typeof Clock }> = {
  queued: { texto: "En cola", tono: "neutral", icono: Clock },
  running: { texto: "Trabajando", tono: "ia", icono: Wrench },
  esperando_aprobacion: { texto: "Necesita tu respuesta", tono: "aviso", icono: CircleAlert },
  done: { texto: "Hecho", tono: "exito", icono: CircleCheck },
  failed: { texto: "No se pudo", tono: "error", icono: CircleAlert },
  cancelled: { texto: "Cancelado", tono: "neutral", icono: CircleAlert },
};

const EJEMPLOS = [
  "Cambia el teléfono del pie de página por 300 123 4567",
  "Añade un enlace a Instagram en el pie de página",
  "Crea una página de contacto con un formulario",
  "Revisa si hay plugins sin actualizar",
];

type Acciones = {
  decidir: (aprobacionId: string, aprobada: boolean) => Promise<Resultado>;
  responder: (aprobacionId: string, respuesta: string) => Promise<Resultado>;
  eliminar: (taskId: string) => Promise<Resultado>;
};

export function EncargosWebmaster({
  nombreAgente,
  sitio,
  encargos,
  encargar,
  decidir,
  responder,
  eliminar,
  vaciar,
}: {
  nombreAgente: string;
  sitio: { nombre: string; url: string } | null;
  encargos: EncargoVista[];
  encargar: (datos: FormData) => Promise<Resultado>;
  vaciar: () => Promise<Resultado>;
} & Acciones) {
  const router = useRouter();
  const formulario = React.useRef<HTMLFormElement>(null);
  const caja = React.useRef<HTMLTextAreaElement>(null);
  const final = React.useRef<HTMLDivElement>(null);
  const [texto, setTexto] = React.useState("");
  const [aviso, setAviso] = React.useState<Resultado | null>(null);
  const [vaciando, setVaciando] = React.useState(false);

  const [estado, enviar, pendiente] = React.useActionState<Resultado | null, FormData>(
    async (_previo, datos) => {
      const resultado = await encargar(datos);
      if (resultado.ok) {
        setTexto("");
        router.refresh();
      }
      return resultado;
    },
    null,
  );

  const hayEnCurso = encargos.some((e) => EN_CURSO.has(e.estado));
  React.useEffect(() => {
    if (!hayEnCurso) return;
    const intervalo = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(intervalo);
  }, [hayEnCurso, router]);

  React.useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth" });
  }, [encargos.length]);

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
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Dónde trabaja ────────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-3">
          <Avatar name={nombreAgente} size="lg" tone="ia" {...(sitio ? { status: "en-linea" as const } : {})} />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-base font-semibold text-fg">{nombreAgente}</p>
            {sitio ? (
              <a
                href={sitio.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1.5 truncate text-2xs text-fg-muted transition-colors hover:text-primary-fg"
              >
                <Globe size={12} aria-hidden />
                Trabaja en {sitio.nombre}
                <ExternalLink size={11} aria-hidden />
              </a>
            ) : (
              <p className="text-2xs text-warning-fg">Sin sitio conectado</p>
            )}
          </div>
          {encargos.length > 0 && (
            <Button size="sm" variant="ghost" loading={vaciando} onClick={vaciarHistorial}>
              <Trash2 size={14} aria-hidden />
              Vaciar historial
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
          {!sitio && (
            <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-warning-fg">
                Conecta tu sitio para que {nombreAgente} pueda hacer cambios en él.
              </p>
              <Button asChild size="sm" className="w-fit">
                <Link href="/ajustes/sitio">Conectar mi sitio</Link>
              </Button>
            </div>
          )}

          {aviso && (
            <p className={cn("text-sm", aviso.ok ? "text-fg-secondary" : "text-danger-fg")} role="status">
              {aviso.ok ? aviso.mensaje : aviso.error}
            </p>
          )}

          {encargos.length === 0 && (
            <div className="strappy-slide-up flex flex-col items-center gap-4 py-12 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-fg">
                <Wrench size={26} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-xl font-semibold text-fg">Encárgale un cambio a {nombreAgente}</p>
                <p className="max-w-[52ch] text-base text-fg-secondary">
                  Lo hace él mismo en tu sitio, guarda una copia antes y te pide permiso en lo delicado.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {EJEMPLOS.map((ejemplo) => (
                  <button
                    key={ejemplo}
                    type="button"
                    disabled={!sitio}
                    onClick={() => usarEjemplo(ejemplo)}
                    className="cursor-pointer rounded-full border border-border bg-raised px-3.5 py-2 text-sm text-fg-secondary transition-colors hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ejemplo}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ol className="flex flex-col gap-6">
            {encargos.map((encargo) => (
              <Encargo
                key={encargo.id}
                encargo={encargo}
                nombreAgente={nombreAgente}
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
      <div className="shrink-0 border-t border-border bg-page">
        <form ref={formulario} action={enviar} className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-4">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-raised p-2 transition-colors focus-within:border-[color-mix(in_oklab,var(--brand),transparent_45%)]">
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
              disabled={!sitio || pendiente}
              placeholder={sitio ? `¿Qué quieres que ${nombreAgente} cambie en tu sitio?` : "Conecta tu sitio para encargar cambios"}
              className="min-h-12 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:outline-none"
            />
            <Button
              type="submit"
              loading={pendiente}
              loadingLabel="Encargando"
              disabled={!sitio || !texto.trim()}
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
  );
}

function Encargo({
  encargo,
  nombreAgente,
  decidir,
  responder,
  eliminar,
}: { encargo: EncargoVista; nombreAgente: string } & Acciones) {
  const router = useRouter();
  const [borrando, setBorrando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const etiqueta = ETIQUETAS[encargo.estado];
  const Icono = etiqueta.icono;
  const enCurso = EN_CURSO.has(encargo.estado);

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
    <li className="strappy-slide-up group flex flex-col gap-3">
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
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-selected px-3.5 py-2 text-md text-fg">
          {encargo.detalle ?? encargo.titulo}
        </div>
      </div>

      {/* Lo que hace o contesta el Webmaster */}
      <div className="flex items-start gap-2">
        <Avatar name={nombreAgente} size="sm" tone="ia" className="mt-1" />
        <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-3 rounded-2xl rounded-tl-sm border border-border bg-raised px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">{nombreAgente}</span>
            <Badge tone={etiqueta.tono}>
              <Icono aria-hidden className={cn(encargo.estado === "running" && "animate-pulse")} />
              {etiqueta.texto}
            </Badge>
            {encargo.creditos > 0 && (
              <span className="tnum ml-auto text-2xs text-fg-muted">{encargo.creditos} créditos</span>
            )}
          </div>

          {enCurso && (
            <div className="flex items-center gap-3 text-sm text-fg-secondary">
              <IndicadorEscribiendo etiqueta={`${nombreAgente} está trabajando`} />
              {encargo.estado === "queued"
                ? "Recibido. Empiezo en cuanto se libere el turno."
                : "Estoy haciendo el cambio en tu sitio. Suele tardar entre uno y cinco minutos."}
            </div>
          )}
          {encargo.resumen && encargo.aprobaciones.length === 0 && (
            <p className="whitespace-pre-wrap text-md text-fg">{encargo.resumen}</p>
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
    <div className="flex flex-col gap-3 rounded-xl border border-border border-l-2 border-l-warning bg-inset px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warning-fg">
        <ShieldAlert size={16} aria-hidden />
        Necesito tu aprobación
      </p>
      <p className="text-md text-fg">{aprobacion.resumen}</p>
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
    <div className="flex flex-col gap-3 rounded-xl border border-border border-l-2 border-l-primary bg-inset px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary-fg">
        <MessageCircleQuestion size={16} aria-hidden />
        Tengo una pregunta
      </p>
      <p className="text-md text-fg">{aprobacion.resumen}</p>
      {aprobacion.opciones.length > 0 && (
        <div className="flex flex-col gap-2">
          {aprobacion.opciones.map((opcion) => (
            <button
              key={opcion}
              type="button"
              disabled={enviando !== null}
              onClick={() => void enviar(opcion)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-raised px-3 py-2.5 text-left text-base text-fg transition-colors hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
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
