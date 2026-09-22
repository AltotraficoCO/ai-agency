"use client";

/**
 * Contratar un agente en cuatro pasos.
 *
 *   1. Elegir        — confirmar qué hace y qué cuesta.
 *   2. Conectar      — lo que le falta al espacio para que sirva de algo.
 *   3. Personalizar  — 3-5 campos. TODO lo demás se hereda de la ficha de
 *                      empresa (`company_profiles`), que se rellena una vez.
 *   4. Probar        — el agente se crea en BORRADOR y el botón lleva al
 *                      simulador.
 *
 * El cuarto paso no es un adorno. Publicar sin probar es lo que hace que un
 * agente mal configurado le conteste a un cliente real, y esa primera respuesta
 * mala cuesta más que todo lo que ahorró el asistente.
 *
 * Cada paso tiene UNA acción principal, a la derecha; «Atrás» siempre a la
 * izquierda y en fantasma. El progreso dice «Paso 2 de 4» con los nombres
 * enteros: truncados («Qué hace y qué c…») no orientaban a nadie.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, CircleDashed, PartyPopper } from "lucide-react";
import { Button, Input, Textarea, cn } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { accionContratar } from "@/lib/negocio/acciones";
import { dolares } from "@/lib/negocio/creditos";
import type { FichaCatalogo } from "@/lib/negocio/catalogo";
import { enlaceParaConectar } from "@/lib/negocio/catalogo-contenido";
import { ICONO_CAPACIDAD } from "./contratar/personajes";
import { RetratoAgente } from "./contratar/retrato-agente";

const PASOS = [
  { id: "elegir", label: "Elegir" },
  { id: "conectar", label: "Conectar" },
  { id: "personalizar", label: "Personalizar" },
  { id: "probar", label: "Probar" },
] as const;

/** Lo que dijo una plataforma al volver de conectarla desde este asistente. */
export type AvisoConexion = { tono: "exito" | "error"; texto: string };

export function AsistenteContratacion({ ficha, aviso }: { ficha: FichaCatalogo; aviso?: AvisoConexion }) {
  const router = useRouter();
  // Quien vuelve de conectar una plataforma aterriza en su paso, no en el
  // primero: el paso a paso no se reinicia por haber salido a dar un permiso.
  const [paso, setPaso] = React.useState(aviso ? 1 : 0);
  const [valores, setValores] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(ficha.campos.map((c) => [c.clave, c.valorPorDefecto])),
  );
  // El nombre es el del catálogo: un agente contratado se llama como se llama.
  const nombre = ficha.nombre;
  const volver = `/contratar/${ficha.slug}`;
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [agenteId, setAgenteId] = React.useState<string | null>(ficha.agenteId);

  const faltanConexiones = ficha.conexiones.filter((c) => !c.lista);

  async function contratar() {
    setEnviando(true);
    setError(null);
    const datos = new FormData();
    datos.set("slug", ficha.slug);
    datos.set("nombre", nombre);
    for (const [clave, valor] of Object.entries(valores)) datos.set(`campo_${clave}`, valor);

    const resultado = await accionContratar(datos);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    const id = resultado.destino?.split("/")[2] ?? null;
    setAgenteId(id);
    setPaso(3);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Progreso paso={paso} />

      {paso === 0 && (
        <Paso
          clave="elegir"
          titulo={`Qué hace ${ficha.nombre}`}
          descripcion={ficha.descripcion ?? undefined}
          principal={
            ficha.contratado && ficha.agenteId ? (
              <EnlaceBoton href={`/agentes/${ficha.agenteId}`}>
                Abrir {ficha.nombre}
                <ArrowRight size={16} aria-hidden />
              </EnlaceBoton>
            ) : (
              <Button onClick={() => setPaso(1)}>
                Continuar
                <ArrowRight size={16} aria-hidden />
              </Button>
            )
          }
          secundaria={
            ficha.contratado && ficha.agenteId ? (
              <Button variant="ghost" onClick={() => setPaso(1)}>
                Volver a configurarlo
              </Button>
            ) : undefined
          }
        >
          {ficha.capacidades.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {ficha.capacidades.map((capacidad) => {
                const Icono = ICONO_CAPACIDAD[capacidad.icono];
                return (
                  <li
                    key={capacidad.titulo}
                    className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset p-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-fg">
                      <Icono size={16} strokeWidth={2} aria-hidden />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-base font-medium text-fg">{capacidad.titulo}</span>
                      <span className="text-sm text-fg-muted">{capacidad.detalle}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <dl className="grid gap-3 rounded-lg border border-[var(--border-subtle)] p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-fg-muted">Tenerlo contratado</dt>
              {/*
                «Incluido en tu plan» sonaba a que el plan es el que te da
                derecho a este agente, y no es así: contratarlo no cuesta nada y
                se paga lo que gaste. Es la misma promesa que ya dice el
                catálogo, y decirla distinta aquí es sembrar la duda justo en la
                pantalla donde se decide.
              */}
              <dd className="text-base font-medium text-fg">
                {ficha.creditosMensuales > 0
                  ? `${dolares(ficha.costeUsd)} al mes, además de tu plan`
                  : "Sin cuota"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-fg-muted">Consumo</dt>
              <dd className="text-base text-fg">
                Créditos de IA según lo que trabaje. Los mensajes de WhatsApp los cobra Meta.
              </dd>
            </div>
          </dl>
        </Paso>
      )}

      {paso === 1 && (
        <Paso
          clave="conectar"
          titulo="Lo que necesita conectado"
          descripcion="Puedes seguir y conectarlo después, pero no trabajará hasta que esté todo listo."
          atras={() => setPaso(0)}
          principal={
            <Button onClick={() => setPaso(2)}>
              {faltanConexiones.length > 0 ? "Seguir sin conectar" : "Continuar"}
              <ArrowRight size={16} aria-hidden />
            </Button>
          }
        >
          {aviso ? (
            <p
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
                aviso.tono === "exito" ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg",
              )}
            >
              {aviso.tono === "exito" ? (
                <CircleCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              ) : (
                <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              )}
              <span>{aviso.texto}</span>
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {ficha.conexiones.map((c) => (
              <li
                key={c.clave}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
                  c.lista
                    ? "border-[color-mix(in_oklab,var(--success),transparent_70%)] bg-success-soft/40"
                    : "border-border bg-inset",
                )}
              >
                {c.lista ? (
                  <CircleCheck size={20} strokeWidth={2} className="shrink-0 text-success-fg" aria-hidden />
                ) : (
                  <CircleDashed size={20} strokeWidth={2} className="shrink-0 text-warning-fg" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-fg">{c.nombre}</p>
                  <p className="text-sm text-fg-muted">{c.descripcion}</p>
                </div>
                {c.lista ? (
                  <span className="text-sm font-medium text-success-fg">Listo</span>
                ) : (
                  <EnlaceBoton href={enlaceParaConectar(c, volver)} variant="secondary" size="sm">
                    Conectar
                  </EnlaceBoton>
                )}
              </li>
            ))}
            {ficha.conexiones.length === 0 && (
              <li className="flex items-center gap-3 rounded-lg border border-border bg-inset px-4 py-3 text-base text-fg-secondary">
                <CircleCheck size={20} strokeWidth={2} className="text-success-fg" aria-hidden />
                Este agente no necesita nada conectado.
              </li>
            )}
          </ul>

          {faltanConexiones.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-fg">
              <CircleAlert size={16} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              Te falta {faltanConexiones.map((c) => enFrase(c.nombre)).join(" y ")}. Puedes seguir y
              conectarlo más tarde.
            </p>
          )}
        </Paso>
      )}

      {paso === 2 && (
        <Paso
          clave="personalizar"
          titulo="Ajústalo a tu negocio"
          // Un agente sin campos propios no enseña un formulario a medias: se
          // dice que no hace falta nada. Prometer «ajústalo» y no preguntar
          // nada es peor que no tener el paso.
          descripcion={
            ficha.campos.length > 0
              ? "Solo esto. Tu empresa, tu horario, tu tono y tus políticas los hereda de la ficha de tu espacio."
              : "Este agente no necesita más ajustes: ya trabaja. Tu empresa, tu horario y tu tono los hereda de la ficha de tu espacio."
          }
          atras={() => setPaso(1)}
          principal={
            <Button onClick={contratar} loading={enviando} loadingLabel="Creando el agente…">
              Crear y probar
              <ArrowRight size={16} aria-hidden />
            </Button>
          }
        >
          {ficha.campos.map((campo) => (
            <Campo key={campo.clave} etiqueta={campo.etiqueta} ayuda={campo.ayuda}>
              {(id) =>
                campo.tipo === "parrafo" ? (
                  <Textarea
                    id={id}
                    rows={3}
                    value={valores[campo.clave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo.clave]: e.target.value }))}
                  />
                ) : campo.tipo === "opcion" ? (
                  <OpcionesEnFila
                    id={id}
                    opciones={campo.opciones ?? []}
                    valor={valores[campo.clave] ?? ""}
                    onCambio={(valor) => setValores((v) => ({ ...v, [campo.clave]: valor }))}
                  />
                ) : (
                  <Input
                    id={id}
                    value={valores[campo.clave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo.clave]: e.target.value }))}
                  />
                )
              }
            </Campo>
          ))}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">
              <CircleAlert size={16} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </Paso>
      )}

      {paso === 3 && (
        <Paso
          clave="probar"
          titulo="Tu agente ya existe. Pruébalo"
          descripcion="Está en borrador: todavía no habla con nadie. Escríbele tú primero y publícalo cuando te convenza."
          principal={
            <Button
              onClick={() => router.push(agenteId ? `/agentes/${agenteId}/probar` : "/agentes")}
            >
              Probar el agente
              <ArrowRight size={16} aria-hidden />
            </Button>
          }
          secundaria={
            <Button variant="ghost" onClick={() => router.push("/contratar")}>
              Volver al catálogo
            </Button>
          }
        >
          <div className="flex flex-col items-center gap-3 rounded-lg bg-inset py-6 text-center">
            <RetratoAgente slug={ficha.slug} tamano={140} />
            <p className="inline-flex items-center gap-2 text-lg font-semibold text-fg">
              <PartyPopper size={18} strokeWidth={2} className="text-primary-fg" aria-hidden />
              {nombre} está listo para probar
            </p>
            {faltanConexiones.length > 0 ? (
              <p className="max-w-[48ch] text-sm text-fg-muted">
                Recuerda conectar {faltanConexiones.map((c) => enFrase(c.nombre)).join(" y ")} antes de
                publicarlo.
              </p>
            ) : null}
          </div>
        </Paso>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Un nombre de conexión dentro de una frase: «Te falta tu sitio web», no
 * «Te falta Tu sitio web». Los nombres propios («WhatsApp») se quedan como están.
 */
function enFrase(nombre: string): string {
  return nombre.startsWith("Tu ") ? `tu ${nombre.slice(3)}` : nombre;
}

/** «Paso 2 de 4 · Conectar» y una barra con los cuatro nombres enteros. */
function Progreso({ paso }: { paso: number }) {
  const actual = PASOS[paso] ?? PASOS[0];
  return (
    <nav aria-label="Progreso de la contratación" className="flex flex-col gap-2.5">
      <p className="text-sm text-fg-muted">
        Paso {paso + 1} de {PASOS.length} ·{" "}
        <span className="font-medium text-fg">{actual.label}</span>
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {PASOS.map((p, indice) => {
          const hecho = indice < paso;
          const activo = indice === paso;
          return (
            <li key={p.id} aria-current={activo ? "step" : undefined} className="flex flex-col gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "h-1 rounded-full transition-colors duration-[var(--dur-base)]",
                  hecho || activo ? "bg-primary" : "bg-[var(--border-default)]",
                )}
              />
              {/* En móvil sobran los nombres: el «Paso 2 de 4» de arriba ya lo dice. */}
              <span
                className={cn(
                  "hidden items-center gap-1 text-sm sm:inline-flex",
                  activo ? "font-medium text-fg" : hecho ? "text-fg-secondary" : "text-fg-muted",
                )}
              >
                {hecho ? <Check size={13} strokeWidth={2.5} className="text-primary-fg" aria-hidden /> : null}
                {p.label}
              </span>
              <span className="sr-only">
                {p.label}
                {hecho ? " (completado)" : activo ? " (paso actual)" : " (pendiente)"}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Un paso del asistente: encabezado, contenido y la barra de acciones. */
function Paso({
  clave,
  titulo,
  descripcion,
  children,
  atras,
  principal,
  secundaria,
}: {
  clave: string;
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
  atras?: () => void;
  principal: React.ReactNode;
  secundaria?: React.ReactNode;
}) {
  return (
    <section
      key={clave}
      aria-labelledby={`paso-${clave}`}
      className="strappy-slide-up overflow-hidden rounded-xl border border-border bg-raised shadow-e1"
    >
      <header className="flex flex-col gap-1 border-b border-[var(--border-subtle)] px-5 py-4">
        <h2 id={`paso-${clave}`} className="text-lg font-semibold tracking-tight text-fg">
          {titulo}
        </h2>
        {descripcion ? <p className="max-w-[65ch] text-base text-fg-secondary">{descripcion}</p> : null}
      </header>

      <div className="flex flex-col gap-5 p-5">{children}</div>

      <footer className="flex flex-col-reverse gap-2 border-t border-[var(--border-subtle)] bg-inset px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex">
          {atras ? (
            <Button variant="ghost" onClick={atras}>
              <ArrowLeft size={16} aria-hidden />
              Atrás
            </Button>
          ) : (
            secundaria
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {atras ? secundaria : null}
          {principal}
        </div>
      </footer>
    </section>
  );
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-medium text-fg">
        {etiqueta}
      </label>
      {children(id)}
      <p className="text-sm text-fg-muted">{ayuda}</p>
    </div>
  );
}

/**
 * Pocas opciones se eligen mejor viéndolas todas que abriendo un desplegable:
 * se ve la elección y se cambia de un toque.
 */
function OpcionesEnFila({
  id,
  opciones,
  valor,
  onCambio,
}: {
  id: string;
  opciones: readonly { valor: string; etiqueta: string }[];
  valor: string;
  onCambio: (valor: string) => void;
}) {
  return (
    <div id={id} role="radiogroup" className="grid gap-2 sm:grid-cols-3">
      {opciones.map((opcion) => {
        const marcada = opcion.valor === valor;
        return (
          <button
            key={opcion.valor}
            type="button"
            role="radio"
            aria-checked={marcada}
            onClick={() => onCambio(opcion.valor)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-base transition-colors duration-[var(--dur-fast)]",
              marcada
                ? "border-primary bg-primary-soft text-fg"
                : "border-border bg-inset text-fg-secondary hover:border-border-strong hover:bg-hover hover:text-fg",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border-2",
                marcada ? "border-primary" : "border-border-strong",
              )}
            >
              {marcada ? <span className="size-1.5 rounded-full bg-primary" /> : null}
            </span>
            {opcion.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
