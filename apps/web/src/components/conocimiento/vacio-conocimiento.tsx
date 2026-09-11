/**
 * Conocimiento sin ninguna base.
 *
 * No basta con «no hay nada»: explica las tres formas de enseñarle a un agente
 * y deja el botón para empezar a mano. Quien llega aquí el primer día tiene que
 * entender en diez segundos para qué sirve la pantalla.
 */
import { ClipboardList, FileUp, Globe, type LucideIcon } from "lucide-react";
import { NuevaBase } from "./nueva-base";

const FORMAS: readonly { icono: LucideIcon; titulo: string; texto: string }[] = [
  {
    icono: Globe,
    titulo: "Tu sitio web",
    texto: "Pega la dirección y lo lee solo: páginas, productos, preguntas frecuentes.",
  },
  {
    icono: FileUp,
    titulo: "Archivos",
    texto: "Sube PDF, Word, Excel, CSV o texto: catálogos, listas de precios, manuales.",
  },
  {
    icono: ClipboardList,
    titulo: "Datos",
    texto: "Escribe o pega lo que no está en ningún sitio: horarios, políticas, promociones.",
  },
];

export function VacioConocimiento() {
  return (
    <section
      aria-labelledby="vacio-conocimiento"
      className="strappy-slide-up flex flex-col items-center gap-8 rounded-2xl border border-dashed border-border px-6 py-12 text-center"
    >
      <div className="flex max-w-[60ch] flex-col items-center gap-2">
        <h2 id="vacio-conocimiento" className="text-2xl font-semibold tracking-tight text-fg">
          Enséñale a tus agentes cómo es tu negocio
        </h2>
        <p className="text-md text-fg-secondary">
          Crea una base de conocimiento y aliméntala. Tus agentes de WhatsApp responderán con esa
          información en lugar de inventar.
        </p>
      </div>

      <ul className="grid w-full max-w-4xl gap-3 text-left sm:grid-cols-3">
        {FORMAS.map(({ icono: Icono, titulo, texto }, i) => (
          <li
            key={titulo}
            style={{ animationDelay: `${60 + i * 60}ms` }}
            className="strappy-slide-up flex flex-col gap-3 rounded-xl border border-border bg-raised p-5"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-fg">
              <Icono size={18} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-fg">{titulo}</p>
              <p className="text-sm text-fg-secondary">{texto}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col items-center gap-2">
        <NuevaBase grande />
        <p className="text-sm text-fg-muted">Después la conectas a los agentes que quieras.</p>
      </div>
    </section>
  );
}
