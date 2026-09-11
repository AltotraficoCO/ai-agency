"use client";

/**
 * «Pruébalo»: lo que encontraría un agente si un cliente preguntara esto.
 *
 * Es la forma de comprobar que aprendió lo que debía sin tener que montar una
 * conversación de prueba. Si no encuentra nada, dice qué hacer.
 */
import * as React from "react";
import { FlaskConical, Search, SearchX } from "lucide-react";
import { Button, Input, toast } from "@strappy/ui";
import { accionProbarBusqueda } from "@/lib/conocimiento/acciones";
import type { FragmentoEncontrado } from "@/lib/conocimiento/tipos";

const EJEMPLOS = ["¿Cuánto cuesta?", "¿A qué hora abren?", "¿Hacen domicilios?"];

const FALLO = { ok: false as const, error: "No pudimos buscar. Vuelve a intentarlo." };

export function Pruebalo({ cerebroId, hayFragmentos }: { cerebroId: string; hayFragmentos: boolean }) {
  const [consulta, setConsulta] = React.useState("");
  const [buscando, setBuscando] = React.useState(false);
  const [resultado, setResultado] = React.useState<{ consulta: string; fragmentos: FragmentoEncontrado[] } | null>(
    null,
  );

  const buscar = async (texto: string) => {
    const limpio = texto.trim();
    if (limpio.length < 2 || buscando) return;
    setConsulta(limpio);
    setBuscando(true);
    const respuesta = await accionProbarBusqueda(cerebroId, limpio).catch(() => FALLO);
    setBuscando(false);
    if (!respuesta.ok) {
      toast.error(respuesta.error);
      return;
    }
    setResultado({ consulta: limpio, fragmentos: respuesta.datos.fragmentos });
  };

  return (
    <section
      aria-labelledby="pruebalo-titulo"
      className="strappy-slide-up rounded-xl border border-border bg-raised p-5 shadow-e1 [animation-delay:120ms]"
    >
      <div className="flex flex-col gap-1 pb-4">
        <h2 id="pruebalo-titulo" className="flex items-center gap-2 text-lg font-semibold text-fg">
          <FlaskConical size={18} aria-hidden className="text-fg-muted" />
          Pruébalo
        </h2>
        <p className="text-sm text-fg-secondary">
          Pregunta como lo haría un cliente y mira qué encontraría tu agente.
        </p>
      </div>

      {hayFragmentos ? (
        <>
          <form
            onSubmit={(evento) => {
              evento.preventDefault();
              void buscar(consulta);
            }}
            className="flex gap-2"
          >
            <Input
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="¿Cuánto cuesta el pan integral?"
              aria-label="Pregunta de prueba"
              className="flex-1"
            />
            <Button type="submit" loading={buscando} loadingLabel="Buscando" disabled={consulta.trim().length < 2}>
              <Search size={16} aria-hidden />
              <span className="sr-only">Buscar</span>
            </Button>
          </form>

          <div aria-live="polite" className="pt-4">
            {resultado === null ? (
              <div className="flex flex-wrap gap-2">
                {EJEMPLOS.map((ejemplo) => (
                  <button
                    key={ejemplo}
                    type="button"
                    onClick={() => void buscar(ejemplo)}
                    className="cursor-pointer rounded-full border border-border bg-inset px-3 py-1 text-sm text-fg-secondary transition-colors hover:border-[color-mix(in_oklab,var(--brand),transparent_50%)] hover:text-fg"
                  >
                    {ejemplo}
                  </button>
                ))}
              </div>
            ) : resultado.fragmentos.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
                <SearchX size={20} aria-hidden className="text-fg-muted" />
                <p className="text-base font-medium text-fg">No encontré nada sobre eso</p>
                <p className="text-sm text-fg-secondary">
                  Añade una fuente que lo cubra, o prueba con otras palabras.
                </p>
              </div>
            ) : (
              <ol className="flex flex-col gap-2">
                <li className="text-2xs uppercase tracking-wide text-fg-muted">
                  {resultado.fragmentos.length === 1
                    ? "1 fragmento encontrado"
                    : `${resultado.fragmentos.length} fragmentos encontrados`}
                </li>
                {resultado.fragmentos.map((fragmento, indice) => (
                  <li
                    key={`${indice}-${fragmento.texto.slice(0, 24)}`}
                    style={{ animationDelay: `${indice * 50}ms` }}
                    className="strappy-slide-up flex flex-col gap-1.5 rounded-lg border border-border border-l-2 border-l-primary bg-inset p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-fg">
                        {fragmento.titulo ?? fragmento.fuente ?? "Fragmento"}
                      </span>
                      <span className="tnum shrink-0 text-2xs text-fg-muted">
                        {Math.round(Math.max(0, Math.min(1, fragmento.puntuacion)) * 100)}%
                      </span>
                    </div>
                    <p className="line-clamp-5 whitespace-pre-wrap text-sm text-fg-secondary">
                      <Resaltado texto={sinMarcas(fragmento.texto)} consulta={resultado.consulta} />
                    </p>
                    {fragmento.fuente && fragmento.titulo ? (
                      <span className="truncate text-2xs text-fg-muted">{fragmento.fuente}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-fg-secondary">
          Cuando termine de aprender de alguna fuente podrás probarlo aquí.
        </p>
      )}
    </section>
  );
}

/**
 * Los fragmentos se guardan en Markdown (así el troceado respeta títulos y
 * tablas), pero la persona no tiene por qué ver `#` ni `**`: se quitan las
 * marcas y se deja el texto.
 */
function sinMarcas(texto: string): string {
  return texto
    // Los encabezados pueden quedar a mitad de línea cuando el troceado junta el
    // título de la página con su primer apartado («Precios # Plan Pro»).
    .replace(/(^|\s)#{1,6}\s+/gm, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Marca en el fragmento las palabras de la pregunta (de tres letras o más, sin tildes). */
function Resaltado({ texto, consulta }: { texto: string; consulta: string }) {
  const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const palabras = Array.from(
    new Set(
      sinTildes(consulta)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((p) => p.length >= 3),
    ),
  );
  if (palabras.length === 0) return <>{texto}</>;

  // Se busca sobre la versión sin tildes y se corta el original en las mismas
  // posiciones: NFD solo añade marcas combinantes, así que se recalcula por letra.
  const partes: React.ReactNode[] = [];
  const normalizado = Array.from(texto).map((letra) => sinTildes(letra));
  const plano = normalizado.join("");
  const letras = Array.from(texto);
  const patron = new RegExp(palabras.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");

  // Mapa de índice en `plano` → índice de letra original.
  const inicioDeLetra: number[] = [];
  let acumulado = 0;
  for (const trozo of normalizado) {
    inicioDeLetra.push(acumulado);
    acumulado += trozo.length;
  }
  const letraEn = (pos: number) => {
    let i = 0;
    while (i + 1 < inicioDeLetra.length && inicioDeLetra[i + 1]! <= pos) i++;
    return i;
  };

  let ultimo = 0;
  for (const coincidencia of plano.matchAll(patron)) {
    const desde = letraEn(coincidencia.index);
    const hasta = letraEn(coincidencia.index + coincidencia[0].length - 1) + 1;
    if (desde > ultimo) partes.push(letras.slice(ultimo, desde).join(""));
    partes.push(
      <mark key={desde} className="rounded-sm bg-primary-soft px-0.5 text-fg">
        {letras.slice(desde, hasta).join("")}
      </mark>,
    );
    ultimo = hasta;
  }
  if (ultimo < letras.length) partes.push(letras.slice(ultimo).join(""));
  return <>{partes}</>;
}
