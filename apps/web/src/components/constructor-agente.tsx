"use client";

/**
 * El constructor de agentes.
 *
 * La tesis de la pantalla, y por eso las dos columnas están pegadas: los
 * formularios de la izquierda ESCRIBEN el prompt de la derecha. Al enfocar un
 * campo se resalta la sección que ese campo produce. Nadie tiene que explicar
 * qué es un prompt; se ve.
 *
 * El editor es de verdad, no una vista previa: si alguien escribe directamente
 * en él, sus palabras ganan sobre lo que compondrían los formularios, y la
 * interfaz lo dice en lugar de sobrescribirlas en silencio.
 */
import * as React from "react";
import { Sparkles, Undo2 } from "lucide-react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView } from "@codemirror/view";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Field,
  Input,
  Textarea,
  toast,
} from "@strappy/ui";
// Del subpaquete `spec`, no del barril: `@strappy/db` arrastra `node:crypto` y
// `node:dns`, y esto es un componente de cliente.
import {
  SECCIONES,
  componerInstrucciones,
  type ClaveSeccion,
  type EspecificacionAgente,
} from "@strappy/db/spec";
import { guardarBorrador, publicarAgente } from "@/lib/acciones-agente";

export interface ConstructorAgenteProps {
  agentId: string;
  inicial: EspecificacionAgente;
  publicado: boolean;
}

export function ConstructorAgente({ agentId, inicial, publicado }: ConstructorAgenteProps) {
  const [spec, setSpec] = React.useState<EspecificacionAgente>(inicial);
  const [manual, setManual] = React.useState<string | null>(
    inicial.instruccionesManuales?.trim() ? inicial.instruccionesManuales : null,
  );
  const [seccion, setSeccion] = React.useState<ClaveSeccion | null>(null);
  const [guardando, setGuardando] = React.useState(false);
  const [publicando, setPublicando] = React.useState(false);
  const editor = React.useRef<ReactCodeMirrorRef>(null);

  const compuesto = React.useMemo(() => componerInstrucciones(spec), [spec]);
  const prompt = manual ?? compuesto;
  const tokens = React.useMemo(() => Math.ceil(prompt.length / 4), [prompt]);

  const rango = React.useMemo(() => (seccion ? rangoDeSeccion(prompt, seccion) : null), [prompt, seccion]);

  const extensiones = React.useMemo(
    () => [markdown(), EditorView.lineWrapping, TEMA_RESALTADO, resaltado(rango)],
    [rango],
  );

  // Al enfocar un campo, el prompt se desplaza a la sección que ese campo escribe.
  React.useEffect(() => {
    if (!rango) return;
    const vista = editor.current?.view;
    if (!vista) return;
    const linea = Math.min(rango.desde, vista.state.doc.lines);
    vista.dispatch({
      effects: EditorView.scrollIntoView(vista.state.doc.line(linea).from, { y: "start" }),
    });
  }, [rango]);

  const actualizar = React.useCallback((cambio: Partial<EspecificacionAgente>) => {
    setSpec((previo) => ({ ...previo, ...cambio }));
  }, []);

  async function alGuardar() {
    setGuardando(true);
    const resultado = await guardarBorrador(agentId, conManual(spec, manual));
    setGuardando(false);
    if (resultado.ok) toast.success("Borrador guardado.");
    else toast.error(resultado.error);
  }

  async function alPublicar() {
    setPublicando(true);
    const resultado = await publicarAgente(agentId, conManual(spec, manual));
    setPublicando(false);
    if (resultado.ok) toast.success("Publicado. El agente ya atiende con estas instrucciones.");
    else toast.error(resultado.error);
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* ── Izquierda: los formularios que escriben el prompt ─────────────── */}
      <aside className="min-h-0 overflow-y-auto border-r border-border p-4">
        <Accordion type="multiple" defaultValue={["identidad", "hace"]}>
          <AccordionItem value="identidad">
            <AccordionTrigger>{SECCIONES.identidad}</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-3">
              <Field label="Cómo se llama">
                {(campo) => (
                  <Input {...campo}
                  value={spec.identidad.nombre}
                  placeholder="Espiga"
                  onFocus={() => setSeccion("identidad")}
                  onChange={(e) =>
                    actualizar({ identidad: { ...spec.identidad, nombre: e.target.value } })
                  }
                />
                )}
              </Field>
              <Field label="Para qué existe" help="Una frase. «atender a quien escribe y no dejar a nadie sin respuesta».">
                {(campo) => (
                  <Textarea {...campo}
                  rows={2}
                  value={spec.identidad.proposito}
                  onFocus={() => setSeccion("identidad")}
                  onChange={(e) =>
                    actualizar({ identidad: { ...spec.identidad, proposito: e.target.value } })
                  }
                />
                )}
              </Field>
              <Field label="Cómo habla" help="Con tus palabras: «cercano y breve, tutea, sin tecnicismos».">
                {(campo) => (
                  <Textarea {...campo}
                  rows={2}
                  value={spec.identidad.tono}
                  onFocus={() => setSeccion("identidad")}
                  onChange={(e) =>
                    actualizar({ identidad: { ...spec.identidad, tono: e.target.value } })
                  }
                />
                )}
              </Field>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="hace">
            <AccordionTrigger>{SECCIONES.hace}</AccordionTrigger>
            <AccordionContent>
              <ListaEditable
                valores={spec.hace}
                marcador="Responde dudas sobre precios y horarios"
                alCambiar={(hace) => actualizar({ hace })}
                alEnfocar={() => setSeccion("hace")}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="noHace">
            <AccordionTrigger>{SECCIONES.noHace}</AccordionTrigger>
            <AccordionContent>
              <ListaEditable
                valores={spec.noHace}
                marcador="No inventa precios que no estén confirmados"
                alCambiar={(noHace) => actualizar({ noHace })}
                alEnfocar={() => setSeccion("noHace")}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="recoger">
            <AccordionTrigger>{SECCIONES.recoger}</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-3">
              {spec.recoger.map((campo, i) => (
                <div key={i} className="flex gap-2">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => actualizar({ recoger: spec.recoger.filter((_, j) => j !== i) })}
                  >
                    Quitar
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  actualizar({ recoger: [...spec.recoger, { clave: "", etiqueta: "" }] })
                }
              >
                Añadir un dato
              </Button>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="escalar">
            <AccordionTrigger>{SECCIONES.escalar}</AccordionTrigger>
            <AccordionContent>
              <ListaEditable
                valores={spec.escalar}
                marcador="Cuando la persona se queje de un pedido"
                alCambiar={(escalar) => actualizar({ escalar })}
                alEnfocar={() => setSeccion("escalar")}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </aside>

      {/* ── Derecha: el prompt, que es lo que el agente lee de verdad ─────── */}
      <section className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-base font-semibold text-fg">Instrucciones del agente</h2>
          {manual ? (
            <Badge tone="aviso">Editado a mano</Badge>
          ) : (
            <Badge tone="ia">Lo escriben los formularios</Badge>
          )}
          <span className="tnum ml-auto text-2xs text-fg-muted">
            {tokens.toLocaleString("es-CO")} tokens aprox.
          </span>
          {manual && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setManual(null);
                toast.success("Vuelve a escribirlo el formulario.");
              }}
            >
              <Undo2 size={16} aria-hidden />
              Deshacer mis cambios
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              toast.info(
                "Mejorar con IA todavía no está conectado. Aparecerá cuando el meta-agente entre en esta pantalla.",
              )
            }
          >
            <Sparkles size={16} aria-hidden />
            Mejorar con IA
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeMirror
            ref={editor}
            value={prompt}
            height="100%"
            className="h-full text-sm"
            theme="none"
            extensions={extensiones}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            onChange={(valor) => setManual(valor)}
          />
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <p className="text-2xs text-fg-muted">
            {publicado
              ? "Publicar reemplaza lo que tu agente usa ahora mismo."
              : "Este agente todavía no atiende a nadie. Publícalo cuando esté listo."}
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={alGuardar} loading={guardando}>
              Guardar borrador
            </Button>
            <Button onClick={alPublicar} loading={publicando}>
              Publicar
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ListaEditable({
  valores,
  marcador,
  alCambiar,
  alEnfocar,
}: {
  valores: string[];
  marcador: string;
  alCambiar: (valores: string[]) => void;
  alEnfocar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {valores.map((valor, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            rows={2}
            className="flex-1"
            value={valor}
            placeholder={marcador}
            onFocus={alEnfocar}
            onChange={(e) => {
              const copia = [...valores];
              copia[i] = e.target.value;
              alCambiar(copia);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Quitar"
            onClick={() => alCambiar(valores.filter((_, j) => j !== i))}
          >
            Quitar
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => alCambiar([...valores, ""])}>
        Añadir
      </Button>
    </div>
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
    backgroundColor: "var(--primary-soft, rgba(99, 85, 240, 0.16))",
    borderLeft: "2px solid var(--primary, #6355F0)",
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
