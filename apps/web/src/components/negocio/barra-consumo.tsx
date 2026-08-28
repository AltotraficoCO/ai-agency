import { SERIES } from "./colores";
import {
  creditosCompactos,
  fraseDeProyeccion,
  porcentaje,
  QUE_ES_UN_CREDITO,
  type Proyeccion,
} from "@/lib/negocio/creditos";
import type { SegmentoAgente } from "@/lib/negocio/analitica";

/**
 * La barra que evita la factura sorpresa.
 *
 * Tres cosas en una sola figura, y en este orden porque es el orden en que se
 * preguntan:
 *   1. cuánto llevas —«12,4 K de 50 K créditos»—, partido por agente para que
 *      se vea QUIÉN gasta;
 *   2. dónde acabarás al ritmo actual, marcado sobre la misma barra;
 *   3. si eso se sale del plan, la zona excedida en ámbar y el aviso escrito.
 *
 * La proyección se dibuja SOBRE la barra y no en un texto aparte: el cliente
 * tiene que ver la relación entre lo gastado y lo que va a gastar sin tener que
 * componerla en la cabeza.
 */
export function BarraConsumo({
  proyeccion,
  segmentos,
}: {
  proyeccion: Proyeccion;
  segmentos: readonly SegmentoAgente[];
}) {
  // La escala llega hasta el mayor entre la asignación y la proyección: si la
  // proyección se sale, tiene que verse cuánto se sale.
  const escala = Math.max(proyeccion.asignados, proyeccion.proyectado, 1);
  const anchoAsignado = (proyeccion.asignados / escala) * 100;
  const anchoProyectado = (proyeccion.proyectado / escala) * 100;

  const visibles = segmentos.slice(0, SERIES.length);
  const restoCreditos = segmentos.slice(SERIES.length).reduce((s, a) => s + a.creditos, 0);

  // Los segmentos vienen del periodo que el cliente tenga seleccionado arriba,
  // que no tiene por qué coincidir con el periodo de facturación de la barra.
  // Se reparten proporcionalmente sobre lo consumido para que la parte coloreada
  // sume EXACTAMENTE la cifra grande: una barra cuyos trozos no suman el total
  // que hay escrito encima destruye la confianza en toda la pantalla.
  const sumaSegmentos = visibles.reduce((s, a) => s + a.creditos, 0) + restoCreditos;
  const proporcion = sumaSegmentos > 0 ? proyeccion.consumidos / sumaSegmentos : 0;
  const ancho = (creditos: number) => ((creditos * proporcion) / escala) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">
          {creditosCompactos(proyeccion.consumidos)}
        </span>
        <span className="text-base text-fg-secondary">
          de {creditosCompactos(proyeccion.asignados)} créditos
        </span>
        <span className="ml-auto text-sm text-fg-muted tabular-nums">
          {porcentaje(proyeccion.porcentajeActual)} usado
        </span>
      </div>

      <div
        className="relative h-4 w-full overflow-hidden rounded-full bg-inset"
        role="img"
        aria-label={`${creditosCompactos(proyeccion.consumidos)} de ${creditosCompactos(
          proyeccion.asignados,
        )} créditos usados. ${fraseDeProyeccion(proyeccion)}`}
      >
        {/* Zona excedida: se pinta primero, debajo de todo lo demás. */}
        {proyeccion.excede && (
          <span
            className="absolute inset-y-0 bg-warning-soft"
            style={{ left: `${anchoAsignado}%`, width: `${Math.max(0, anchoProyectado - anchoAsignado)}%` }}
          />
        )}
        {/* Lo ya consumido, partido por agente. */}
        <span className="absolute inset-y-0 left-0 flex">
          {visibles.map((s, i) => (
            <span
              key={s.agenteId ?? s.nombre}
              style={{ width: `${ancho(s.creditos)}%`, backgroundColor: SERIES[i % SERIES.length] }}
            />
          ))}
          {restoCreditos > 0 && (
            <span
              style={{ width: `${ancho(restoCreditos)}%`, backgroundColor: "var(--fg-muted)" }}
            />
          )}
        </span>
        {/* Marca de la asignación del plan. */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
          style={{ left: `${anchoAsignado}%` }}
        />
        {/* Marca de la proyección. */}
        {proyeccion.fiable && (
          <span
            aria-hidden
            className={`absolute inset-y-0 w-0.5 ${proyeccion.excede ? "bg-warning" : "bg-primary-fg"}`}
            style={{ left: `${Math.min(99.5, anchoProyectado)}%` }}
          />
        )}
      </div>

      <p
        className={`text-sm ${proyeccion.excede ? "text-warning-fg" : "text-fg-secondary"}`}
        data-proyeccion={proyeccion.proyectado}
      >
        {fraseDeProyeccion(proyeccion)}
        {proyeccion.excede && proyeccion.fiable && (
          <>
            {" "}
            Puedes recargar créditos —no caducan— o subir de plan antes de llegar.
          </>
        )}
      </p>

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
