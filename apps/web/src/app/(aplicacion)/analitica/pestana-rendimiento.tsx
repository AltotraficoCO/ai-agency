import { Bot } from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
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
 *
 * «Resuelve sola» lleva una barra además del número: comparar 62% con 81% en
 * una columna de cifras obliga a leer; comparar dos barras, no.
 */
export function PestanaRendimiento({ analitica }: { analitica: AnaliticaStrappy }) {
  const filas = analitica.rendimiento;

  return (
    <Card className="strappy-slide-up">
      <CardHeader>
        <CardTitle>Rendimiento por agente</CardTitle>
        <CardDescription>
          Qué parte resuelve cada agente sin ayuda, cuánto tarda y cuánto cuesta cada conversación.
        </CardDescription>
      </CardHeader>
      <CardBody>
        {filas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-hover text-fg-muted">
              <Bot size={20} strokeWidth={1.75} aria-hidden />
            </span>
            <div>
              <p className="text-base font-medium text-fg">Ningún agente trabajó en este periodo</p>
              <p className="mt-1 text-sm text-fg-muted">
                Prueba con otro rango de fechas o pon a atender a uno de tus agentes.
              </p>
            </div>
            <EnlaceBoton href="/agentes" variant="secondary" size="sm">
              Ver mis agentes
            </EnlaceBoton>
          </div>
        ) : (
          <>
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
                  {filas.map((f) => {
                    const autonomia = Math.round(f.tasaAutonomia * 100);
                    return (
                      <tr
                        key={f.agenteId ?? f.nombre}
                        className="border-b border-[var(--border-subtle)] transition-colors duration-[var(--dur-fast)] hover:bg-hover"
                      >
                        <th scope="row" className="py-3 pr-3 text-left font-medium text-fg">
                          {f.nombre}
                        </th>
                        <td className="px-3 py-3">
                          <Minigrafico serie={f.serie} titulo={`Conversaciones diarias de ${f.nombre}`} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-fg">{f.conversaciones}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-inset">
                              <span className="block h-full rounded-full bg-primary" style={{ width: `${autonomia}%` }} />
                            </span>
                            <span className="w-9 text-right tabular-nums text-fg">{autonomia}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-fg-secondary">
                          {f.tiempoMedioMs === null ? "—" : duracion(f.tiempoMedioMs)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-human-fg">{f.escalamientos}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-fg">{creditosCompactos(f.creditos)}</td>
                        <td className="py-3 pl-3 text-right tabular-nums text-fg">
                          {f.costePorConversacion.toFixed(2)}
                          <span className="ml-1 text-2xs text-fg-muted">
                            ({creditosEnDolares(f.costePorConversacion)})
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
          </>
        )}
      </CardBody>
    </Card>
  );
}
