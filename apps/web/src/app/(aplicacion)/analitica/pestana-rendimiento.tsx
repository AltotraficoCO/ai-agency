import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { Minigrafico } from "@/components/negocio/graficos";
import { VerComoTabla } from "@/components/negocio/tabla-equivalente";
import { duracion } from "@/components/negocio/tarjeta-indicador";
import { creditosCompactos, creditosEnDolares } from "@/lib/negocio/creditos";
import type { AnaliticaStrappy } from "@/lib/negocio/analitica";

/**
 * Rendimiento agente a agente.
 *
 * La columna que decide es «Créditos por conversación»: es lo que dice si un
 * agente sale a cuenta. Va con su equivalencia en dólares al lado porque
 * «0,42 créditos» no significa nada para quien firma la factura.
 */
export function PestanaRendimiento({ analitica }: { analitica: AnaliticaStrappy }) {
  const filas = analitica.rendimiento;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rendimiento por agente</CardTitle>
        <CardDescription>
          Qué parte resuelve cada agente sin ayuda, cuánto tarda y cuánto cuesta cada conversación.
        </CardDescription>
      </CardHeader>
      <CardBody>
        {filas.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Todavía no hay actividad de ningún agente en este periodo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-2xs tracking-wide text-fg-muted uppercase">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    Agente
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Actividad
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Conversaciones
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Resuelve sola
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Tiempo medio
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Escalamientos
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Créditos
                  </th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">
                    Por conversación
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.agenteId ?? f.nombre} className="border-b border-[var(--border-subtle)]">
                    <th scope="row" className="py-2.5 pr-3 text-left font-medium text-fg">
                      {f.nombre}
                    </th>
                    <td className="px-3 py-2.5">
                      <Minigrafico
                        serie={f.serie}
                        titulo={`Conversaciones diarias de ${f.nombre}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{f.conversaciones}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-primary-fg">
                      {Math.round(f.tasaAutonomia * 100)}%
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">
                      {f.tiempoMedioMs === null ? "—" : duracion(f.tiempoMedioMs)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-human-fg">
                      {f.escalamientos}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">
                      {creditosCompactos(f.creditos)}
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums text-fg">
                      {f.costePorConversacion.toFixed(2)}
                      <span className="ml-1 text-2xs text-fg-muted">
                        ({creditosEnDolares(f.costePorConversacion)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <VerComoTabla
          titulo="Rendimiento por agente"
          columnas={[
            { clave: "agente", etiqueta: "Agente" },
            { clave: "conversaciones", etiqueta: "Conversaciones", numerica: true },
            { clave: "autonomia", etiqueta: "Resuelve sola", numerica: true },
            { clave: "tiempo", etiqueta: "Tiempo medio", numerica: true },
            { clave: "escalamientos", etiqueta: "Escalamientos", numerica: true },
            { clave: "creditos", etiqueta: "Créditos", numerica: true },
            { clave: "porConversacion", etiqueta: "Por conversación", numerica: true },
          ]}
          filas={filas.map((f) => ({
            agente: f.nombre,
            conversaciones: f.conversaciones,
            autonomia: `${Math.round(f.tasaAutonomia * 100)}%`,
            tiempo: f.tiempoMedioMs === null ? "—" : duracion(f.tiempoMedioMs),
            escalamientos: f.escalamientos,
            creditos: creditosCompactos(f.creditos),
            porConversacion: f.costePorConversacion.toFixed(2),
          }))}
        />
      </CardBody>
    </Card>
  );
}
