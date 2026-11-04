import { SERIES } from "./colores";
import { creditosCompactos, QUE_ES_UN_CREDITO } from "@/lib/negocio/creditos";
import type { SegmentoAgente } from "@/lib/negocio/analitica";

/**
 * Lo gastado este mes frente a lo que queda.
 *
 * La barra va de cero a «gastado + disponible», partida por agente para que se
 * vea QUIÉN gasta. Lo vacío es el saldo que todavía no se ha tocado.
 */
export function BarraConsumo({
  consumidos,
  disponible,
  fraseRitmo,
  segmentos,
}: {
  consumidos: number;
  disponible: number;
  fraseRitmo: string | null;
  segmentos: readonly SegmentoAgente[];
}) {
  const escala = Math.max(consumidos + disponible, 1);

  const visibles = segmentos.slice(0, SERIES.length);
  const restoCreditos = segmentos.slice(SERIES.length).reduce((s, a) => s + a.creditos, 0);

  // Se reparten proporcionalmente sobre lo consumido para que la parte coloreada
  // sume EXACTAMENTE la cifra grande: una barra cuyos trozos no suman el total
  // que hay escrito encima destruye la confianza en toda la pantalla.
  const sumaSegmentos = visibles.reduce((s, a) => s + a.creditos, 0) + restoCreditos;
  const proporcion = sumaSegmentos > 0 ? consumidos / sumaSegmentos : 0;
  const ancho = (creditos: number) => ((creditos * proporcion) / escala) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">
          {creditosCompactos(consumidos)}
        </span>
        <span className="text-base text-fg-secondary">créditos gastados este mes</span>
        <span className="ml-auto text-sm text-fg-muted tabular-nums">
          {creditosCompactos(disponible)} disponibles
        </span>
      </div>

      <div
        className="relative h-4 w-full overflow-hidden rounded-full bg-inset"
        role="img"
        aria-label={`${creditosCompactos(consumidos)} créditos gastados este mes, ${creditosCompactos(disponible)} disponibles.`}
      >
        <span className="absolute inset-y-0 left-0 flex">
          {visibles.map((s, i) => (
            <span
              key={s.agenteId ?? s.nombre}
              style={{ width: `${ancho(s.creditos)}%`, backgroundColor: SERIES[i % SERIES.length] }}
            />
          ))}
          {restoCreditos > 0 && (
            <span style={{ width: `${ancho(restoCreditos)}%`, backgroundColor: "var(--fg-muted)" }} />
          )}
        </span>
      </div>

      {fraseRitmo && <p className="text-sm text-fg-secondary">{fraseRitmo}</p>}

      {visibles.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-secondary" aria-label="Reparto por agente">
          {visibles.map((s, i) => (
            <li key={s.agenteId ?? s.nombre} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: SERIES[i % SERIES.length] }}
              />
              {s.nombre}
              <span className="tabular-nums text-fg-muted">{creditosCompactos(s.creditos)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-2xs text-fg-muted">{QUE_ES_UN_CREDITO}</p>
    </div>
  );
}
