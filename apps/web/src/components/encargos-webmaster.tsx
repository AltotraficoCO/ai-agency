"use client";

/**
 * Encargos al Webmaster.
 *
 * Parece un chat, pero cada mensaje es un encargo: se guarda como tarea y el
 * worker lo ejecuta sobre el sitio conectado. Mientras hay algo en cola o en
 * marcha la pantalla se refresca sola, porque el resultado llega minutos
 * después y nadie debería tener que recargar para verlo.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Badge, Button, Textarea } from "@strappy/ui";
import type { EncargoVista } from "@/lib/encargos/encargos";
import type { Resultado } from "@/lib/negocio/acciones";

const EN_CURSO = new Set<EncargoVista["estado"]>(["queued", "running"]);

const ETIQUETAS: Record<EncargoVista["estado"], { texto: string; aviso: boolean }> = {
  queued: { texto: "En cola", aviso: false },
  running: { texto: "Trabajando", aviso: false },
  esperando_aprobacion: { texto: "Necesita tu aprobación", aviso: true },
  done: { texto: "Hecho", aviso: false },
  failed: { texto: "No se pudo", aviso: true },
  cancelled: { texto: "Cancelado", aviso: true },
};

export function EncargosWebmaster({
  nombreAgente,
  sitio,
  encargos,
  encargar,
  decidir,
  eliminar,
  vaciar,
}: {
  nombreAgente: string;
  sitio: { nombre: string; url: string } | null;
  encargos: EncargoVista[];
  encargar: (datos: FormData) => Promise<Resultado>;
  decidir: (aprobacionId: string, aprobada: boolean) => Promise<Resultado>;
  eliminar: (taskId: string) => Promise<Resultado>;
  vaciar: () => Promise<Resultado>;
}) {
  const router = useRouter();
  const formulario = React.useRef<HTMLFormElement>(null);
  const final = React.useRef<HTMLDivElement>(null);
  const [aviso, setAviso] = React.useState<Resultado | null>(null);
  const [vaciando, setVaciando] = React.useState(false);

  const [estado, enviar, pendiente] = React.useActionState<Resultado | null, FormData>(
    async (_previo, datos) => {
      const resultado = await encargar(datos);
      if (resultado.ok) {
        formulario.current?.reset();
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        {sitio ? (
          <p className="text-sm text-fg-secondary">
            Trabaja en <span className="font-medium text-fg">{sitio.nombre}</span> · {sitio.url}
          </p>
        ) : (
          <p className="rounded-lg bg-inset px-3 py-2 text-sm text-fg-secondary">
            Conecta tu sitio en{" "}
            <Link className="text-primary-fg underline" href="/ajustes/sitio">
              Ajustes → Sitio web
            </Link>{" "}
            para que {nombreAgente} pueda hacer cambios.
          </p>
        )}
        {encargos.length > 0 && (
          <Button size="sm" variant="ghost" loading={vaciando} onClick={vaciarHistorial}>
            Vaciar historial
          </Button>
        )}
      </div>
      {aviso && (
        <p className={`text-sm ${aviso.ok ? "text-fg-secondary" : "text-danger-fg"}`} role="status">
          {aviso.ok ? aviso.mensaje : aviso.error}
        </p>
      )}

      <ol className="flex flex-col gap-5">
        {encargos.length === 0 && (
          <li className="text-sm text-fg-muted">
            Pídele un cambio concreto, por ejemplo «cambia el teléfono del pie de página por 300 123 4567» o «crea
            una página de contacto con un formulario».
          </li>
        )}
        {encargos.map((encargo) => (
          <Encargo
            key={encargo.id}
            encargo={encargo}
            nombreAgente={nombreAgente}
            decidir={decidir}
            eliminar={eliminar}
          />
        ))}
      </ol>
      <div ref={final} />

      <form
        ref={formulario}
        action={enviar}
        className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4"
      >
        <Textarea
          name="texto"
          rows={3}
          required
          disabled={!sitio}
          placeholder={`¿Qué quieres que ${nombreAgente} cambie en tu sitio?`}
        />
        <div className="flex items-center justify-between gap-3">
          {estado && !estado.ok ? (
            <p className="text-sm text-danger-fg" role="status">
              {estado.error}
            </p>
          ) : (
            <span className="text-2xs text-fg-muted">
              Guarda una copia antes de cada cambio y te pide aprobación en lo delicado.
            </span>
          )}
          <Button type="submit" loading={pendiente} disabled={!sitio}>
            Encargar
          </Button>
        </div>
      </form>
    </div>
  );
}

function Encargo({
  encargo,
  nombreAgente,
  decidir,
  eliminar,
}: {
  encargo: EncargoVista;
  nombreAgente: string;
  decidir: (aprobacionId: string, aprobada: boolean) => Promise<Resultado>;
  eliminar: (taskId: string) => Promise<Resultado>;
}) {
  const router = useRouter();
  const [decidiendo, setDecidiendo] = React.useState<string | null>(null);
  const [borrando, setBorrando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const etiqueta = ETIQUETAS[encargo.estado];

  async function responder(aprobacionId: string, aprobada: boolean) {
    setDecidiendo(aprobacionId);
    setError(null);
    const resultado = await decidir(aprobacionId, aprobada);
    setDecidiendo(null);
    if (resultado.ok) router.refresh();
    else setError(resultado.error);
  }

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
    <li className="group flex flex-col gap-2">
      <div className="flex items-start justify-end gap-2">
        {encargo.estado !== "running" && (
          <button
            type="button"
            onClick={borrar}
            disabled={borrando}
            aria-label="Eliminar encargo"
            title="Eliminar encargo"
            className="mt-1.5 rounded-md p-1 text-fg-muted opacity-60 transition-opacity hover:text-danger-fg hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
          >
            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-inset px-3 py-2 text-sm text-fg">
          {encargo.detalle ?? encargo.titulo}
        </div>
      </div>

      <div className="flex max-w-[85%] flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center gap-2 text-2xs">
          <span className="font-medium text-fg-secondary">{nombreAgente}</span>
          {etiqueta.aviso ? <Badge tone="aviso">{etiqueta.texto}</Badge> : <Badge>{etiqueta.texto}</Badge>}
        </div>

        {encargo.estado === "queued" && (
          <p className="text-sm text-fg-secondary">Recibido. Empiezo en cuanto se libere el turno.</p>
        )}
        {encargo.estado === "running" && (
          <p className="text-sm text-fg-secondary">
            Estoy haciendo el cambio en tu sitio. Suele tardar entre uno y cinco minutos.
          </p>
        )}
        {encargo.resumen && <p className="whitespace-pre-wrap text-sm text-fg">{encargo.resumen}</p>}
        {encargo.estado === "failed" && encargo.error && (
          <p className="text-sm text-danger-fg">{encargo.error}</p>
        )}

        {encargo.aprobaciones.map((aprobacion) => (
          <div key={aprobacion.id} className="flex flex-col gap-2 rounded-md bg-inset px-3 py-2">
            <p className="text-sm text-fg">{aprobacion.resumen}</p>
            <p className="text-2xs text-fg-muted">Te pido aprobación porque {aprobacion.motivo}.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={decidiendo === aprobacion.id}
                disabled={decidiendo !== null}
                onClick={() => responder(aprobacion.id, true)}
              >
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={decidiendo !== null}
                onClick={() => responder(aprobacion.id, false)}
              >
                Rechazar
              </Button>
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-danger-fg">{error}</p>}
      </div>
    </li>
  );
}
