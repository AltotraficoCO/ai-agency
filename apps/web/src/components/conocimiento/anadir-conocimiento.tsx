"use client";

/**
 * Añadir conocimiento: las tres formas de enseñarle algo a la base.
 *
 * Tres tarjetas seleccionables en vez de un formulario con un desplegable de
 * «tipo de fuente»: quien no sabe qué es una fuente sí sabe si tiene una web,
 * unos archivos o unos datos que pegar.
 */
import * as React from "react";
import {
  CircleAlert,
  ClipboardList,
  FileText,
  FileUp,
  Globe,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, Field, Input, Textarea, ToggleField, cn, toast } from "@strappy/ui";
import { accionAgregarTexto, accionAgregarUrl } from "@/lib/conocimiento/acciones";
import {
  FORMATOS_ACEPTADOS,
  TAMANO_MAXIMO_MB,
  type RespuestaSubida,
} from "@/lib/conocimiento/tipos";

type Forma = "web" | "archivos" | "datos";

const FORMAS: readonly { id: Forma; icono: LucideIcon; titulo: string; texto: string }[] = [
  { id: "web", icono: Globe, titulo: "Sitio web", texto: "Lee tu página" },
  { id: "archivos", icono: FileUp, titulo: "Archivos", texto: "PDF, Word, Excel…" },
  { id: "datos", icono: ClipboardList, titulo: "Datos", texto: "Pega precios o FAQ" },
];

const FALLO = { ok: false as const, error: "No pudimos guardarlo. Vuelve a intentarlo." };

export function AnadirConocimiento({ cerebroId, onAnadido }: { cerebroId: string; onAnadido: () => void }) {
  const [forma, setForma] = React.useState<Forma>("web");
  const idBase = React.useId();

  return (
    <section
      aria-labelledby={`${idBase}-titulo`}
      className="strappy-slide-up overflow-hidden rounded-xl border border-border bg-raised shadow-e1"
    >
      <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] p-5 pb-4">
        <h2 id={`${idBase}-titulo`} className="text-lg font-semibold text-fg">
          Añadir conocimiento
        </h2>
        <p className="text-sm text-fg-secondary">Elige de dónde lo sacamos. Aprende en segundo plano.</p>
      </div>

      <div role="tablist" aria-label="Forma de añadir conocimiento" className="grid grid-cols-3 gap-2 p-4 pb-0">
        {FORMAS.map(({ id, icono: Icono, titulo, texto }) => {
          const activa = forma === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${idBase}-tab-${id}`}
              aria-selected={activa}
              aria-controls={`${idBase}-panel-${id}`}
              onClick={() => setForma(id)}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors duration-[var(--dur-fast)] sm:flex-row sm:items-center",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                activa
                  ? "border-[color-mix(in_oklab,var(--brand),transparent_40%)] bg-primary-soft"
                  : "border-border bg-inset hover:border-border-strong hover:bg-hover",
              )}
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md transition-colors",
                  activa ? "bg-primary text-[var(--fg-on-brand)]" : "bg-hover text-fg-secondary",
                )}
              >
                <Icono size={17} strokeWidth={1.9} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-base font-semibold text-fg">{titulo}</span>
                <span className="hidden truncate text-2xs text-fg-muted sm:block">{texto}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${idBase}-panel-${forma}`}
        aria-labelledby={`${idBase}-tab-${forma}`}
        className="p-5"
      >
        {forma === "web" ? <PanelWeb cerebroId={cerebroId} onAnadido={onAnadido} /> : null}
        {forma === "archivos" ? <PanelArchivos cerebroId={cerebroId} onAnadido={onAnadido} /> : null}
        {forma === "datos" ? <PanelDatos cerebroId={cerebroId} onAnadido={onAnadido} /> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sitio web
// ---------------------------------------------------------------------------

function normalizarUrl(cruda: string): string | null {
  const limpia = cruda.trim();
  if (!limpia) return null;
  const conEsquema = /^https?:\/\//i.test(limpia) ? limpia : `https://${limpia}`;
  try {
    const url = new URL(conEsquema);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

function PanelWeb({ cerebroId, onAnadido }: { cerebroId: string; onAnadido: () => void }) {
  const [url, setUrl] = React.useState("");
  const [todoElSitio, setTodoElSitio] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const normalizada = normalizarUrl(url);
    if (!normalizada) {
      setError("Escribe una dirección válida, por ejemplo tunegocio.com");
      return;
    }
    setError(null);
    setEnviando(true);
    const resultado = await accionAgregarUrl(cerebroId, { url: normalizada, todoElSitio }).catch(() => FALLO);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    toast.success(todoElSitio ? "Leyendo tu sitio. Aparecerá en la lista al terminar." : "Leyendo la página.");
    setUrl("");
    onAnadido();
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Field
        label="Dirección de la web"
        error={error ?? undefined}
        help="Tu página principal, o una concreta como la de precios o preguntas frecuentes."
      >
        {(props) => (
          <Input
            {...props}
            type="text"
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://tunegocio.com"
          />
        )}
      </Field>
      <ToggleField
        label="Leer todo el sitio"
        description="Recorre hasta unas 15 páginas del mismo dominio. Apágalo para leer solo esta página."
        checked={todoElSitio}
        onCheckedChange={setTodoElSitio}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={enviando} loadingLabel="Enviando">
          <Sparkles size={16} aria-hidden />
          Aprender de esta web
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------

type ArchivoEnCola = {
  readonly clave: string;
  readonly archivo: File;
  readonly error: string | null;
};

const BYTES_MAXIMOS = TAMANO_MAXIMO_MB * 1024 * 1024;

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto >= 0 ? nombre.slice(punto).toLowerCase() : "";
}

function validar(archivo: File): string | null {
  if (!(FORMATOS_ACEPTADOS as readonly string[]).includes(extensionDe(archivo.name))) {
    return "Formato no admitido";
  }
  if (archivo.size > BYTES_MAXIMOS) return `Pesa más de ${TAMANO_MAXIMO_MB} MB`;
  if (archivo.size === 0) return "Está vacío";
  return null;
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PanelArchivos({ cerebroId, onAnadido }: { cerebroId: string; onAnadido: () => void }) {
  const [cola, setCola] = React.useState<ArchivoEnCola[]>([]);
  const [arrastrando, setArrastrando] = React.useState(false);
  const [progreso, setProgreso] = React.useState<number | null>(null);
  const [rechazados, setRechazados] = React.useState<RespuestaSubida["rechazados"]>([]);
  const entrada = React.useRef<HTMLInputElement>(null);

  const anadir = (lista: FileList | null) => {
    if (!lista) return;
    const nuevos = Array.from(lista).map((archivo) => ({
      clave: `${archivo.name}-${archivo.size}-${archivo.lastModified}`,
      archivo,
      error: validar(archivo),
    }));
    setRechazados([]);
    setCola((previos) => {
      const vistas = new Set(previos.map((p) => p.clave));
      return [...previos, ...nuevos.filter((n) => !vistas.has(n.clave))];
    });
  };

  const validos = cola.filter((c) => c.error === null);
  const subiendo = progreso !== null;

  const subir = () => {
    if (validos.length === 0 || subiendo) return;
    const datos = new FormData();
    for (const { archivo } of validos) datos.append("archivos", archivo, archivo.name);

    // XMLHttpRequest y no fetch: es lo único que da progreso real de subida.
    const peticion = new XMLHttpRequest();
    peticion.open("POST", `/api/conocimiento/${cerebroId}/archivos`);
    peticion.upload.onprogress = (evento) => {
      if (evento.lengthComputable) setProgreso(Math.round((evento.loaded / evento.total) * 100));
    };
    peticion.onerror = () => {
      setProgreso(null);
      toast.error("Se cortó la subida. Revisa tu conexión y vuelve a intentarlo.");
    };
    peticion.onload = () => {
      setProgreso(null);
      let cuerpo: Partial<RespuestaSubida> & { error?: string } = {};
      try {
        cuerpo = JSON.parse(peticion.responseText) as typeof cuerpo;
      } catch {
        // Respuesta sin cuerpo JSON: se trata como fallo genérico.
      }
      if (peticion.status < 200 || peticion.status >= 300) {
        toast.error(cuerpo.error ?? "No pudimos subir los archivos.");
        return;
      }
      const recibidos = cuerpo.recibidos ?? 0;
      const fuera = cuerpo.rechazados ?? [];
      setRechazados(fuera);
      setCola((previos) => previos.filter((c) => c.error !== null));
      if (recibidos > 0) {
        toast.success(
          recibidos === 1 ? "Archivo recibido. Ya está aprendiendo." : `${recibidos} archivos recibidos. Ya están aprendiendo.`,
        );
        onAnadido();
      }
      if (fuera.length > 0) toast.error(`${fuera.length} no se pudieron usar. Mira el motivo abajo.`);
    };
    setProgreso(0);
    peticion.send(datos);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(evento) => {
          evento.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(evento) => {
          evento.preventDefault();
          setArrastrando(false);
          anadir(evento.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-[var(--dur-fast)]",
          arrastrando
            ? "border-primary bg-primary-soft"
            : "border-border bg-inset hover:border-border-strong",
        )}
      >
        <span
          className={cn(
            "grid size-12 place-items-center rounded-full transition-colors",
            arrastrando ? "bg-primary text-[var(--fg-on-brand)]" : "bg-hover text-fg-secondary",
          )}
        >
          <Upload size={20} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-fg">
            {arrastrando ? "Suéltalos aquí" : "Arrastra tus archivos aquí"}
          </p>
          <p className="text-sm text-fg-muted">
            PDF, Word, Excel, CSV o texto · hasta {TAMANO_MAXIMO_MB} MB cada uno
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => entrada.current?.click()}>
          Elegir archivos
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          accept={FORMATOS_ACEPTADOS.join(",")}
          className="sr-only"
          aria-label="Elegir archivos para subir"
          onChange={(evento) => {
            anadir(evento.target.files);
            evento.target.value = "";
          }}
        />
      </div>

      {cola.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Archivos para subir">
          {cola.map(({ clave, archivo, error }) => (
            <li
              key={clave}
              className={cn(
                "strappy-fade-in flex items-center gap-3 rounded-lg border px-3 py-2",
                error ? "border-[color-mix(in_oklab,var(--danger),transparent_60%)] bg-danger-soft" : "border-border bg-inset",
              )}
            >
              <FileText size={16} aria-hidden className={error ? "text-danger-fg" : "text-fg-muted"} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-fg">{archivo.name}</span>
                <span className={cn("text-2xs", error ? "text-danger-fg" : "text-fg-muted")}>
                  {error ?? tamano(archivo.size)}
                </span>
              </span>
              {!subiendo ? (
                <button
                  type="button"
                  aria-label={`Quitar ${archivo.name}`}
                  onClick={() => setCola((previos) => previos.filter((c) => c.clave !== clave))}
                  className="grid size-7 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {subiendo ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progreso}
            aria-label="Progreso de la subida"
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-default)]"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-base)]"
              style={{ width: `${progreso}%` }}
            />
          </div>
          <p className="text-sm text-fg-muted">
            {progreso !== null && progreso < 100 ? `Subiendo… ${progreso}%` : "Procesando en el servidor…"}
          </p>
        </div>
      ) : null}

      {rechazados.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-live="polite" aria-label="Archivos no admitidos">
          {rechazados.map((r) => (
            <li key={r.nombre} className="flex items-start gap-2 text-sm text-danger-fg">
              <CircleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{r.nombre}</span>: {r.motivo}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {validos.length > 0
            ? `${validos.length} ${validos.length === 1 ? "archivo listo" : "archivos listos"} para subir`
            : "Aún no has elegido archivos"}
        </p>
        <Button type="button" onClick={subir} disabled={validos.length === 0} loading={subiendo} loadingLabel="Subiendo">
          <Sparkles size={16} aria-hidden />
          Subir y aprender
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const PLANTILLAS: readonly { etiqueta: string; titulo: string; texto: string }[] = [
  {
    etiqueta: "Lista de precios",
    titulo: "Precios",
    texto: "Producto o servicio — precio\nPan campesino — $6.000\nTorta de chocolate (8 porciones) — $45.000",
  },
  {
    etiqueta: "Preguntas frecuentes",
    titulo: "Preguntas frecuentes",
    texto: "¿Hacen domicilios?\nSí, en toda la ciudad por $5.000.\n\n¿Qué medios de pago aceptan?\nEfectivo, tarjeta y transferencia.",
  },
  {
    etiqueta: "Horarios",
    titulo: "Horarios",
    texto: "Lunes a viernes: 7:00 a 19:00\nSábados: 8:00 a 14:00\nDomingos y festivos: cerrado",
  },
  {
    etiqueta: "Políticas",
    titulo: "Políticas de cambios y devoluciones",
    texto: "Aceptamos cambios hasta 5 días después de la compra con la factura.",
  },
];

const MINIMO_CARACTERES = 20;

function PanelDatos({ cerebroId, onAnadido }: { cerebroId: string; onAnadido: () => void }) {
  const [titulo, setTitulo] = React.useState("");
  const [texto, setTexto] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!titulo.trim()) {
      setError("Ponle un título para reconocerlo en la lista.");
      return;
    }
    if (texto.trim().length < MINIMO_CARACTERES) {
      setError("Escribe un poco más: con tan poco texto no hay nada que aprender.");
      return;
    }
    setError(null);
    setEnviando(true);
    const resultado = await accionAgregarTexto(cerebroId, { titulo: titulo.trim(), texto: texto.trim() }).catch(
      () => FALLO,
    );
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    toast.success("Guardado. Ya está aprendiendo.");
    setTitulo("");
    setTexto("");
    onAnadido();
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-muted">Empieza con:</span>
        {PLANTILLAS.map((p) => (
          <button
            key={p.etiqueta}
            type="button"
            onClick={() => {
              setTitulo(p.titulo);
              setTexto(p.texto);
              setError(null);
            }}
            className="cursor-pointer rounded-full border border-border bg-inset px-3 py-1 text-sm text-fg-secondary transition-colors hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg"
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      <Field label="Título">
        {(props) => (
          <Input
            {...props}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Precios y promociones"
            maxLength={120}
          />
        )}
      </Field>
      <Field
        label="Contenido"
        error={error ?? undefined}
        help="Escríbelo como se lo explicarías a alguien nuevo en tu equipo. Puedes pegar tablas o listas."
      >
        {(props) => (
          <Textarea
            {...props}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={8}
            maxRows={18}
            placeholder={"¿Hacen domicilios?\nSí, en toda la ciudad por $5.000."}
          />
        )}
      </Field>
      <div className="flex items-center justify-between gap-3">
        <span className="tnum text-2xs text-fg-muted">{texto.trim().length.toLocaleString("es-CO")} caracteres</span>
        <Button type="submit" loading={enviando} loadingLabel="Guardando">
          <Sparkles size={16} aria-hidden />
          Guardar y aprender
        </Button>
      </div>
    </form>
  );
}
