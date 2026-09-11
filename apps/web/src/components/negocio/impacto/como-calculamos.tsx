import { Calculator, ChevronDown } from "lucide-react";
import { Card } from "@strappy/ui";
import {
  CREDITOS_POR_USD,
  MAXIMO_POR_ENCARGO,
  MINIMO_POR_ENCARGO,
  TRABAJOS,
  formatearDinero,
  formatearHoras,
  type AjustesImpacto,
  type TipoTrabajo,
} from "@/lib/negocio/impacto-calculo";
import { ICONO_TRABAJO } from "./desglose";

/**
 * «Cómo calculamos esto», plegado.
 *
 * Enseña la MISMA tabla que usa el cálculo (se importa de
 * `impacto-calculo.ts`, no se copia): si alguien cambia un minuto allí, cambia
 * aquí. Un ahorro que no se puede explicar en una tabla no es creíble, y un
 * negocio que no se lo cree no vuelve a esta pantalla. `<details>` nativo:
 * funciona sin JavaScript y el lector de pantalla lo anuncia como desplegable.
 */
export function ComoCalculamos({ ajustes }: { ajustes: AjustesImpacto }) {
  const tipos = Object.keys(TRABAJOS) as TipoTrabajo[];

  return (
    <Card className="strappy-slide-up">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 focus-visible:outline-2 sm:p-5 [&::-webkit-details-marker]:hidden">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-fg-secondary">
            <Calculator size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-fg">Cómo calculamos esto</span>
            <span className="text-2xs text-fg-muted">Una estimación que puedes revisar línea a línea</span>
          </span>
          <ChevronDown
            size={18}
            strokeWidth={1.75}
            className="shrink-0 text-fg-muted transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="flex flex-col gap-4 border-t border-[var(--border-subtle)] p-4 text-sm text-fg-secondary sm:p-5">
          <ol className="flex flex-col gap-3">
            <li>
              <span className="font-medium text-fg">1. Tiempo de una persona.</span> Cada encargo terminado suma los
              minutos de los tipos de trabajo que hizo, una vez cada tipo. Nunca menos de {MINIMO_POR_ENCARGO} min ni
              más de {formatearHoras(MAXIMO_POR_ENCARGO)} por encargo. Si un encargo no guardó sus pasos, lo estimamos
              por las palabras de lo que pediste.
            </li>
            <li>
              <span className="font-medium text-fg">2. Dinero ahorrado.</span> Horas × tu tarifa (
              {formatearDinero(ajustes.tarifaHora, ajustes.moneda)} por hora
              {ajustes.personalizada ? "" : ", la de partida"}).
            </li>
            <li>
              <span className="font-medium text-fg">3. Lo que costó.</span> Los créditos que gastaron esos encargos:{" "}
              {new Intl.NumberFormat("es-CO").format(CREDITOS_POR_USD)} créditos = 1 USD.
            </li>
            <li>
              <span className="font-medium text-fg">4. Retorno.</span> Dinero ahorrado ÷ lo que costó. Si tu moneda no
              es el dólar, necesitamos que nos digas cuánto vale 1 USD: no inventamos el tipo de cambio.
            </li>
          </ol>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Minutos de una persona por tipo de trabajo</caption>
              <thead className="bg-inset">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-2xs font-medium tracking-wide text-fg-muted uppercase">
                    Tipo de trabajo
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-2xs font-medium tracking-wide text-fg-muted uppercase">
                    Minutos
                  </th>
                </tr>
              </thead>
              <tbody>
                {tipos.map((tipo) => {
                  const Icono = ICONO_TRABAJO[tipo];
                  return (
                    <tr key={tipo} className="border-t border-[var(--border-subtle)]">
                      <td className="px-3 py-2">
                        <span className="flex items-start gap-2">
                          <Icono size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
                          <span className="flex flex-col">
                            <span className="text-fg">{TRABAJOS[tipo].etiqueta}</span>
                            <span className="text-2xs text-fg-muted">{TRABAJOS[tipo].ejemplo}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-fg tabular-nums">{TRABAJOS[tipo].minutos}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-2xs text-fg-muted">
            Son cifras conservadoras y no incluyen lo que no se ve: buscar a alguien, explicarle el cambio o esperar a
            que tenga hueco. Preguntarte algo o pedirte permiso no cuenta como trabajo.
          </p>
        </div>
      </details>
    </Card>
  );
}
