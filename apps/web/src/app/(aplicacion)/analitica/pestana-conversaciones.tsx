import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { GraficoAtencion, GraficoDesenlaces } from "@/components/negocio/graficos";
import { VerComoTabla } from "@/components/negocio/tabla-equivalente";
import type { AnaliticaStrappy } from "@/lib/negocio/analitica";

/**
 * La pestaña que responde a «¿cuánto resuelve la IA sola?».
 *
 * El área apilada índigo/fucsia no es decoración: el porcentaje índigo ES la
 * propuesta de valor del producto. Por eso va antes que cualquier otra cosa y
 * lleva escrito el dato en una frase, no solo dibujado.
 */
export function PestanaConversaciones({ analitica }: { analitica: AnaliticaStrappy }) {
  const totalIa = analitica.atencion.reduce((s, p) => s + p.ia, 0);
  const totalHumano = analitica.atencion.reduce((s, p) => s + p.humano, 0);
  const total = totalIa + totalHumano;
  const porcentajeIa = total > 0 ? Math.round((totalIa / total) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Quién atendió</CardTitle>
          <CardDescription>
            {total > 0
              ? `Tu agente resolvió el ${porcentajeIa}% de las conversaciones sin ayuda de nadie. El resto pasó a una persona de tu equipo.`
              : "Cuando entren conversaciones verás qué parte resolvió la IA sola y qué parte pasó a una persona."}
          </CardDescription>
        </CardHeader>
        <CardBody>
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

      <Card>
        <CardHeader>
          <CardTitle>Cómo terminaron</CardTitle>
          <CardDescription>Desenlace de las conversaciones analizadas en el periodo.</CardDescription>
        </CardHeader>
        <CardBody>
          {analitica.desenlaces.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Todavía no hay conversaciones analizadas en este periodo.
            </p>
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
