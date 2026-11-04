"use client";

/**
 * Ventas por mes. Una sola serie y una sola magnitud: barras finas de un solo
 * color, y el título la nombra, así que no hace falta leyenda. Las cifras exactas
 * están en la tabla de debajo.
 */
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { mesCorto } from "@/lib/plataforma/meses";
import type { MesDeVentas } from "@/lib/plataforma/estadisticas";

const USD = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function GraficoVentas({ meses }: { meses: readonly MesDeVentas[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={meses as MesDeVentas[]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="mes"
            tickFormatter={mesCorto}
            tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-subtle)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
            tickFormatter={(v: number) => USD.format(v)}
            tickLine={false}
            axisLine={false}
            width={56}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--hover, rgba(127,127,127,.08))" }}
            contentStyle={{
              backgroundColor: "var(--s-overlay)",
              border: "1px solid var(--border-default)",
              borderRadius: "8px",
              fontSize: "13px",
              color: "var(--fg-default)",
            }}
            labelFormatter={(v) => mesCorto(String(v))}
            formatter={(valor) => [USD.format(Number(valor)), "Ventas"]}
          />
          <Bar dataKey="usd" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
