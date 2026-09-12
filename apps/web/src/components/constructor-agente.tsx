"use client";

/**
 * El constructor de agentes.
 *
 * Dos columnas en escritorio: a la izquierda un formulario en tarjetas con
 * preguntas en el idioma de la persona —cómo se llama, qué hace, qué no hace,
 * cuándo te pasa la conversación—; a la derecha, SIEMPRE a la vista, las
 * instrucciones técnicas que esas respuestas van escribiendo en vivo. Ver cómo
 * cada respuesta se convierte en instrucción es lo que da confianza (Victor lo
 * pidió así: «a la izquierda iba poniendo y a la derecha se iba viendo»).
 *
 * En móvil no caben dos columnas: lo técnico queda plegado debajo del
 * formulario. Si alguien edita las instrucciones a mano, sus palabras ganan
 * sobre lo que compondría el formulario, y la pantalla lo avisa arriba en vez
 * de sobrescribirlas en silencio.
 */
import * as React from "react";
import {
  ChevronDown,
  Code2,
  Hand,
  ListChecks,
  MessageSquareText,
  Plus,
  ShieldX,
  Undo2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView } from "@codemirror/view";
import { Badge, Button, Field, Input, Textarea, cn, toast } from "@strappy/ui";
// Del subpaquete `spec`, no del barril: `@strappy/db` arrastra `node:crypto` y
// `node:dns`, y esto es un componente de cliente.
import {
  SECCIONES,
  componerInstrucciones,
  type ClaveSeccion,
  type EspecificacionAgente,
} from "@strappy/db/spec";
import { guardarBorrador, publicarAgente } from "@/lib/acciones-agente";
import { mejorarInstrucciones } from "@/lib/acciones-mejora";
import { aplicarMejora, type CambioPropuesto, type Mejora, type SeccionMejorable } from "@/lib/agentes/mejora";
import { BotonMejorar, PropuestaMejora } from "@/components/agentes/propuesta-mejora";

export interface ConstructorAgenteProps {
  agentId: string;
  inicial: EspecificacionAgente;
  publicado: boolean;
  /** Lo que va entre el título y el formulario, p. ej. el selector de foto. */
  cabecera?: React.ReactNode;
}

export function ConstructorAgente({ agentId, inicial, publicado, cabecera }: ConstructorAgenteProps) {
  const [spec, setSpec] = React.useState<EspecificacionAgente>(inicial);
  const [manual, setManual] = React.useState<string | null>(
    inicial.instruccionesManuales?.trim() ? inicial.instruccionesManuales : null,
  );
  const [seccion, setSeccion] = React.useState<ClaveSeccion | null>(null);
  const [guardando, setGuardando] = React.useState(false);
  const [publicando, setPublicando] = React.useState(false);
  const [tecnicas, setTecnicas] = React.useState(false);
  const [sucio, setSucio] = React.useState(false);
  const [mejorando, setMejorando] = React.useState(false);
  const [propuesta, setPropuesta] = React.useState<{
    mejora: Mejora;
    cambios: readonly CambioPropuesto[];
    creditos: number;
  } | null>(null);
  const editor = React.useRef<ReactCodeMirrorRef>(null);
  const escritorio = useEsEscritorio();
  // En escritorio el panel técnico está siempre montado; en móvil, solo desplegado.
  const tecnicasVisibles = escritorio || tecnicas;

  const compuesto = React.useMemo(() => componerInstrucciones(spec), [spec]);
  const prompt = manual ?? compuesto;
  const tokens = React.useMemo(() => Math.ceil(prompt.length / 4), [prompt]);

  const rango = React.useMemo(() => (seccion ? rangoDeSeccion(prompt, seccion) : null), [prompt, seccion]);

  const extensiones = React.useMemo(
    () => [markdown(), EditorView.lineWrapping, TEMA_RESALTADO, resaltado(rango)],
    [rango],
  );

  // Con las instrucciones técnicas a la vista, enfocar un campo lleva a la
  // sección que ese campo escribe.
  React.useEffect(() => {
    if (!rango || !tecnicasVisibles) return;
    const vista = editor.current?.view;
    if (!vista) return;
    const linea = Math.min(rango.desde, vista.state.doc.lines);
    vista.dispatch({
      effects: EditorView.scrollIntoView(vista.state.doc.line(linea).from, { y: "center" }),
    });
  }, [rango, tecnicasVisibles]);

  const actualizar = React.useCallback((cambio: Partial<EspecificacionAgente>) => {
    setSpec((previo) => ({ ...previo, ...cambio }));
    setSucio(true);
  }, []);

  async function alGuardar() {
    setGuardando(true);
    const resultado = await guardarBorrador(agentId, conManual(spec, manual));
    setGuardando(false);
    if (resultado.ok) {
      setSucio(false);
      toast.success("Borrador guardado.");
    } else toast.error(resultado.error);
  }

  async function alPublicar() {
    setPublicando(true);
    const resultado = await publicarAgente(agentId, conManual(spec, manual));
    setPublicando(false);
    if (resultado.ok) {
      setSucio(false);
      toast.success("Publicado. El agente ya atiende con estas instrucciones.");
    } else toast.error(resultado.error);
  }

  /**
   * Pide una mejora de la ficha.
   *
   * Trabaja SIEMPRE sobre el formulario, nunca sobre el texto escrito a mano:
   * reescribir con un modelo lo que alguien afinó a mano sería lo contrario de
   * ayudar. Si hay texto manual se avisa antes, porque entonces la mejora no se
   * verá reflejada en el panel de la derecha hasta volver al formulario.
   */
  async function alMejorar() {
    if (manual) {
      toast.info(
        "Editaste el texto a mano, así que la mejora trabaja sobre el formulario y no lo toca.",
      );
    }
    setMejorando(true);
    const resultado = await mejorarInstrucciones(agentId, spec);
    setMejorando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    if (resultado.cambios.length === 0) {
      toast.success("Tus instrucciones ya están bien: no encontré nada que mejorar.");
      return;
    }
    setPropuesta({
      mejora: resultado.mejora,
      cambios: resultado.cambios,
      creditos: resultado.creditos,
    });
  }

  /** Aplica lo aceptado y deja a mano la vuelta atrás, sin recargar la página. */
  function alAplicarMejora(secciones: SeccionMejorable[]) {
    if (!propuesta) return;
    const anterior = spec;
    setSpec(aplicarMejora(spec, propuesta.mejora, secciones));
    setSucio(true);
    setPropuesta(null);
    toast.success("Aplicado. Revísalo y guarda si te convence.", {
      action: {
        label: "Deshacer",
        onClick: () => {
          setSpec(anterior);
          toast.success("Volvimos a tus instrucciones de antes.");
        },
      },
    });
  }

  /** Cabecera y editor de las instrucciones técnicas; se monta en la columna derecha o plegado en móvil. */
  const panelTecnico = (alto: string) => (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {manual ? <Badge tone="aviso">Editado a mano</Badge> : <Badge tone="ia">Lo escribe el formulario</Badge>}
        <span className="tnum ml-auto text-2xs text-fg-muted">{tokens.toLocaleString("es-CO")} tokens aprox.</span>
        <BotonMejorar cargando={mejorando} onClick={alMejorar} />
      </div>
      <div className={cn("min-h-0 bg-inset", alto === "100%" ? "flex-1" : "")}>
        <CodeMirror
          ref={editor}
          value={prompt}
          height={alto}
          className="h-full font-mono text-[13px] leading-relaxed [&_.cm-content]:font-mono [&_.cm-scroller]:font-mono"
          theme="none"
          extensions={extensiones}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
          onChange={(valor) => {
            setManual(valor);
            setSucio(true);
          }}
        />
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PropuestaMejora
        abierta={propuesta !== null}
        cambios={propuesta?.cambios ?? []}
        resumen={propuesta?.mejora.resumen ?? ""}
        creditos={propuesta?.creditos ?? 0}
        onAplicar={alAplicarMejora}
        onCerrar={() => setPropuesta(null)}
      />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-8">
          <div className="strappy-slide-up flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight text-fg">Cómo trabaja tu agente</h2>
            <p className="text-base text-fg-secondary">
              Responde con tus palabras. Con esto se escriben las instrucciones que tu agente sigue en cada
              conversación.
            </p>
          </div>

          {cabecera}

          {manual ? (
            <div
              role="status"
              className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-warning-fg">
                Editaste las instrucciones técnicas a mano. Mientras sea así, los cambios de este formulario no
                se aplican.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="w-fit shrink-0"
                onClick={() => {
                  setManual(null);
                  setSucio(true);
                  toast.success("Vuelve a escribirlas el formulario.");
                }}
              >
                <Undo2 size={16} aria-hidden />
                Volver al formulario
              </Button>
            </div>
          ) : null}

          <Seccion
            icono={UserRound}
            titulo={SECCIONES.identidad}
            descripcion="Su nombre, para qué existe y cómo le habla a tus clientes."
            activa={seccion === "identidad"}
          >
            <Field label="Cómo se llama">
              {(campo) => (
                <Input
                  {...campo}
                  value={spec.identidad.nombre}
                  placeholder="Espiga"
                  onFocus={() => setSeccion("identidad")}
                  onChange={(e) => actualizar({ identidad: { ...spec.identidad, nombre: e.target.value } })}
                />
              )}
            </Field>
            <Field label="Para qué existe" help="Una frase. «atender a quien escribe y no dejar a nadie sin respuesta».">
              {(campo) => (
                <Textarea
                  {...campo}
                  rows={2}
                  value={spec.identidad.proposito}
                  onFocus={() => setSeccion("identidad")}
                  onChange={(e) => actualizar({ identidad: { ...spec.identidad, proposito: e.target.value } })}
                />
              )}
            </Field>
            <Field label="Cómo habla" help="Con tus palabras: «cercano y breve, tutea, sin tecnicismos».">
              {(campo) => (
                <Textarea
                  {...campo}
                  rows={2}
                  value={spec.identidad.tono}
                  onFocus={() => setSeccion("identidad")}
                  onChange={(e) => actualizar({ identidad: { ...spec.identidad, tono: e.target.value } })}
                />
              )}
            </Field>
          </Seccion>

          <Seccion
            icono={ListChecks}
            titulo={SECCIONES.hace}
            descripcion="Lo que resuelve solo, sin tener que preguntarte."
            activa={seccion === "hace"}
          >
            <ListaEditable
              valores={spec.hace}
              marcador="Responde dudas sobre precios y horarios"
              anadir="Añadir algo que hace"
              alCambiar={(hace) => actualizar({ hace })}
              alEnfocar={() => setSeccion("hace")}
            />
          </Seccion>

          <Seccion
            icono={ShieldX}
            titulo={SECCIONES.noHace}
            descripcion="Los límites: lo que nunca debe prometer ni inventar."
            activa={seccion === "noHace"}
          >
            <ListaEditable
              valores={spec.noHace}
              marcador="No inventa precios que no estén confirmados"
              anadir="Añadir un límite"
              alCambiar={(noHace) => actualizar({ noHace })}
              alEnfocar={() => setSeccion("noHace")}
            />
          </Seccion>

          <Seccion
            icono={MessageSquareText}
            titulo={SECCIONES.recoger}
            descripcion="Los datos que averigua durante la charla y guarda en Contactos."
            activa={seccion === "recoger"}
          >
            <div className="flex flex-col gap-2">
              {spec.recoger.map((campo, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label="Nombre del dato"
                    className="flex-1"
                    value={campo.etiqueta}
                    placeholder="ciudad de entrega"
                    onFocus={() => setSeccion("recoger")}
                    onChange={(e) => {
                      const recoger = [...spec.recoger];
                      recoger[i] = {
                        ...campo,
                        etiqueta: e.target.value,
                        clave: campo.clave || aClave(e.target.value),
                      };
                      actualizar({ recoger });
                    }}
                  />
                  <BotonQuitar onClick={() => actualizar({ recoger: spec.recoger.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <BotonAnadir
                texto="Añadir un dato"
                onClick={() => actualizar({ recoger: [...spec.recoger, { clave: "", etiqueta: "" }] })}
              />
            </div>
          </Seccion>

          <Seccion
            icono={Hand}
            titulo={SECCIONES.escalar}
            descripcion="Cuándo deja de responder y le pasa la conversación a tu equipo."
            activa={seccion === "escalar"}
          >
            <ListaEditable
              valores={spec.escalar}
              marcador="Cuando la persona se queje de un pedido"
              anadir="Añadir un caso"
              alCambiar={(escalar) => actualizar({ escalar })}
              alEnfocar={() => setSeccion("escalar")}
            />
          </Seccion>

          {/* ── Móvil: lo técnico, plegado debajo del formulario ─────────────── */}
          {!escritorio ? (
            <div className="overflow-hidden rounded-xl border border-border bg-raised">
              <button
                type="button"
                aria-expanded={tecnicas}
                onClick={() => setTecnicas((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hover text-fg-muted">
                  <Code2 size={16} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-medium text-fg">Ver instrucciones técnicas</span>
                  <span className="text-sm text-fg-muted">
                    El texto exacto que lee tu agente. Solo si quieres afinarlo a mano.
                  </span>
                </span>
                {manual ? <Badge tone="aviso">Editado a mano</Badge> : null}
                <ChevronDown
                  size={16}
                  aria-hidden
                  className={cn(
                    "shrink-0 text-fg-muted transition-transform duration-[var(--dur-base)]",
                    tecnicas && "rotate-180",
                  )}
                />
              </button>
              {tecnicas ? <div className="strappy-fade-in border-t border-border">{panelTecnico("420px")}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Escritorio: lo técnico, siempre a la vista y en vivo ───────────── */}
      {escritorio ? (
        <aside
          aria-label="Instrucciones técnicas"
          className="flex min-h-0 flex-col border-l border-border bg-raised"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hover text-fg-muted">
              <Code2 size={16} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-base font-semibold text-fg">Instrucciones del agente</span>
              <span className="text-sm text-fg-muted">Se escriben solas mientras respondes a la izquierda.</span>
            </span>
          </div>
          {panelTecnico("100%")}
        </aside>
      ) : null}
      </div>

      {/* ── Acciones, siempre a la vista ─────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-page/95 backdrop-blur">
        <div className="flex w-full flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center">
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            {sucio ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                Tienes cambios sin guardar.
              </>
            ) : publicado ? (
              "Publicar reemplaza lo que tu agente usa ahora mismo."
            ) : (
              "Este agente todavía no atiende a nadie. Publícalo cuando esté listo."
            )}
          </p>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="secondary" onClick={alGuardar} loading={guardando} loadingLabel="Guardando">
              Guardar borrador
            </Button>
            <Button onClick={alPublicar} loading={publicando} loadingLabel="Publicando">
              Publicar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Seccion({
  icono: Icono,
  titulo,
  descripcion,
  activa,
  children,
}: {
  icono: LucideIcon;
  titulo: string;
  descripcion: string;
  activa: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "strappy-slide-up flex flex-col gap-4 rounded-xl border bg-raised p-5 transition-colors duration-[var(--dur-base)]",
        activa ? "border-[color-mix(in_oklab,var(--brand),transparent_55%)]" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
            activa ? "bg-primary-soft text-primary-fg" : "bg-hover text-fg-secondary",
          )}
        >
          <Icono size={18} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-lg font-semibold text-fg">{titulo}</h3>
          <p className="text-sm text-fg-muted">{descripcion}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ListaEditable({
  valores,
  marcador,
  anadir,
  alCambiar,
  alEnfocar,
}: {
  valores: string[];
  marcador: string;
  anadir: string;
  alCambiar: (valores: string[]) => void;
  alEnfocar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {valores.map((valor, i) => (
        <div key={i} className="flex items-start gap-2">
          <Textarea
            rows={1}
            className="min-h-10 flex-1"
            value={valor}
            placeholder={marcador}
            onFocus={alEnfocar}
            onChange={(e) => {
              const copia = [...valores];
              copia[i] = e.target.value;
              alCambiar(copia);
            }}
          />
          <BotonQuitar onClick={() => alCambiar(valores.filter((_, j) => j !== i))} />
        </div>
      ))}
      {valores.length === 0 ? <p className="text-sm text-fg-muted">Todavía no hay nada aquí.</p> : null}
      <BotonAnadir texto={anadir} onClick={() => alCambiar([...valores, ""])} />
    </div>
  );
}

function BotonQuitar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Quitar"
      title="Quitar"
      onClick={onClick}
      className="mt-1 grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger-fg"
    >
      <X size={16} aria-hidden />
    </button>
  );
}

function BotonAnadir({ texto, onClick }: { texto: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm font-medium text-fg-secondary transition-colors hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-primary-fg"
    >
      <Plus size={16} aria-hidden />
      {texto}
    </button>
  );
}

function conManual(spec: EspecificacionAgente, manual: string | null): EspecificacionAgente {
  if (!manual) {
    const { instruccionesManuales: _descartado, ...resto } = spec;
    return resto;
  }
  return { ...spec, instruccionesManuales: manual };
}

/** «ciudad de entrega» → `ciudad_de_entrega`. */
function aClave(etiqueta: string): string {
  return etiqueta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

type Rango = { desde: number; hasta: number };

/** Líneas (1-based) que ocupa una sección dentro del Markdown. */
function rangoDeSeccion(texto: string, clave: ClaveSeccion): Rango | null {
  const lineas = texto.split("\n");
  const encabezado = `## ${SECCIONES[clave]}`;
  const inicio = lineas.findIndex((l) => l.trim() === encabezado);
  if (inicio === -1) return null;
  let fin = lineas.length - 1;
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (lineas[i]?.startsWith("## ")) {
      fin = i - 1;
      break;
    }
  }
  return { desde: inicio + 1, hasta: fin + 1 };
}

const LINEA_RESALTADA = Decoration.line({ class: "cm-seccion-activa" });

/**
 * El estilo del resaltado viaja con la extensión, no en la hoja global: así la
 * relación campo → sección no se rompe porque alguien limpie `globals.css`.
 */
const TEMA_RESALTADO = EditorView.baseTheme({
  ".cm-seccion-activa": {
    backgroundColor: "var(--brand-soft, rgba(57, 255, 20, 0.08))",
    borderLeft: "2px solid var(--brand, #39FF14)",
    marginLeft: "-2px",
  },
});

function resaltado(rango: Rango | null) {
  return EditorView.decorations.compute(["doc"], (estado) => {
    if (!rango) return Decoration.none;
    const marcas = [];
    const ultima = Math.min(rango.hasta, estado.doc.lines);
    for (let n = Math.max(1, rango.desde); n <= ultima; n++) {
      marcas.push(LINEA_RESALTADA.range(estado.doc.line(n).from));
    }
    return Decoration.set(marcas);
  });
}

/** Escritorio a partir de 1024 px: ahí caben las dos columnas. */
function useEsEscritorio(): boolean {
  return React.useSyncExternalStore(
    (avisar) => {
      const consulta = window.matchMedia("(min-width: 1024px)");
      consulta.addEventListener("change", avisar);
      return () => consulta.removeEventListener("change", avisar);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}
