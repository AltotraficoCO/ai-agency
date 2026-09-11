import { ChartPie } from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { GraficoAtencion, GraficoDesenlaces } from "@/components/negocio/graficos";
import { VerComoTabla } from "@/components/negocio/tabla-equivalente";
import type { AnaliticaStrappy } from "@/lib/negocio/analitica";

/**
 * La pestaña que responde a «¿cuánto resuelve la IA sola?».
 *
 * El área apilada verde/azul no es decoración: el porcentaje verde ES la
 * propuesta de valor del producto. Por eso va antes que cualquier otra cosa,
 * con la cifra en grande al lado del título y escrita en una frase, no solo
 * dibujada.
 */
export function PestanaConversaciones({ analitica }: { analitica: AnaliticaStrappy }) {
  const totalIa = analitica.atencion.reduce((s, p) => s + p.ia, 0);
  const totalHumano = analitica.atencion.reduce((s, p) => s + p.humano, 0);
  const total = totalIa + totalHumano;
  const porcentajeIa = total > 0 ? Math.round((totalIa / total) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="strappy-slide-up lg:col-span-2">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle>Quién atendió</CardTitle>
            <CardDescription>
              {total > 0
                ? `De ${total.toLocaleString("es-CO")} conversaciones, tu agente cerró ${totalIa.toLocaleString("es-CO")} sin ayuda. El resto pasó a tu equipo.`
                : "Cuando entren conversaciones verás qué parte resolvió la IA sola y qué parte pasó a una persona."}
            </CardDescription>
          </div>
          {total > 0 && (
            <div className="text-right">
              <p className="text-3xl font-semibold tracking-tight text-primary-fg tabular-nums">{porcentajeIa}%</p>
              <p className="text-2xs text-fg-muted">resuelto por la IA</p>
            </div>
          )}
        </CardHeader>
        <CardBody>
          <ul className="mb-3 flex flex-wrap gap-2 text-2xs" aria-label="Leyenda de la gráfica">
            <li className="inline-flex items-center gap-1.5 rounded-full bg-hover px-2.5 py-1 text-fg-secondary">
              <span aria-hidden className="size-2 rounded-full bg-primary" />
              Resueltas por la IA
              <span className="tabular-nums text-fg">{totalIa.toLocaleString("es-CO")}</span>
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full bg-hover px-2.5 py-1 text-fg-secondary">
              <span aria-hidden className="size-2 rounded-full bg-human" />
              Pasadas a tu equipo
              <span className="tabular-nums text-fg">{totalHumano.toLocaleString("es-CO")}</span>
            </li>
          </ul>
          <GraficoAtencion datos={analitica.atencion.map((p) => ({ ...p }))} />
          <VerComoTabla
            titulo="Conversaciones atendidas por la IA y por personas, día a día"
            columnas={[
              { clave: "dia", etiqueta: "Día" },
              { clave: "ia", etiqueta: "Resueltas por la IA", numerica: true },
              { clave: "humano", etiqueta: "Pasadas a una persona", numerica: true },
            ]}
            filas={analitica.atencion.map((p) => ({ dia: p.dia, ia: p.ia, humano: p.humano }))}
          />
        </CardBody>
      </Card>

      <Card className="strappy-slide-up">
        <CardHeader>
          <CardTitle>Cómo terminaron</CardTitle>
          <CardDescription>El desenlace de las conversaciones analizadas en el periodo.</CardDescription>
        </CardHeader>
        <CardBody>
          {analitica.desenlaces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-hover text-fg-muted">
                <ChartPie size={20} strokeWidth={1.75} aria-hidden />
              </span>
              <p className="text-base font-medium text-fg">Aún no hay desenlaces</p>
              <p className="max-w-[30ch] text-sm text-fg-muted">
                Cuando se analice una conversación verás si acabó en venta, en una duda resuelta o con tu equipo.
              </p>
            </div>
          ) : (
            <>
              <GraficoDesenlaces
                datos={analitica.desenlaces.map((d) => ({ etiqueta: d.etiqueta, valor: d.valor }))}
              />
              <VerComoTabla
                titulo="Desenlace de las conversaciones"
                columnas={[
                  { clave: "etiqueta", etiqueta: "Desenlace" },
                  { clave: "valor", etiqueta: "Conversaciones", numerica: true },
                ]}
                filas={analitica.desenlaces.map((d) => ({ etiqueta: d.etiqueta, valor: d.valor }))}
              />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
