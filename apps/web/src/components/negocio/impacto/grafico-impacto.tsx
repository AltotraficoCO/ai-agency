"use client";

/**
 * Trabajo y ahorro en el tiempo.
 *
 * Dos lecturas en una gráfica, cada una con su eje: las barras son los
 * encargos terminados cada día y la línea el ahorro ACUMULADO del periodo.
 * Acumulado y no diario a propósito: la pregunta es «¿cuánto llevo ahorrado?»,
 * y una línea que solo sube se entiende sin leer el eje. Sigue las reglas de
 * `graficos.tsx`: Recharts, colores del tema y ejes a 11px.
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatearDinero, type Moneda } from "@/lib/negocio/impacto-calculo";

const EJE = { fontSize: 11, fill: "var(--fg-muted)" } as const;

const ESTILO_TOOLTIP = {
  backgroundColor: "var(--s-overlay)",
  border: "1px solid var(--border-default)",
  borderRadius: "8px",
  fontSize: "13px",
  color: "var(--fg-default)",
  boxShadow: "var(--shadow-2)",
} as const;

function diaCorto(dia: string): string {
  const fecha = new Date(`${dia}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(fecha);
}

const COMPACTO = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });

export type PuntoImpactoUI = { dia: string; completados: number; ahorroAcumulado: number };

const NOMBRES: Readonly<Record<string, string>> = {
  completados: "Encargos terminados",
  ahorroAcumulado: "Ahorro acumulado",
};

export function GraficoImpacto({ datos, moneda }: { datos: readonly PuntoImpactoUI[]; moneda: Moneda }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={datos as PuntoImpactoUI[]} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="3 4" />
          <XAxis
            dataKey="dia"
            tick={EJE}
            tickLine={false}
            axisLine={{ stroke: "var(--border-subtle)" }}
            tickFormatter={diaCorto}
            minTickGap={24}
          />
          <YAxis
            yAxisId="encargos"
            tick={EJE}
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="ahorro"
            orientation="right"
            tick={EJE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => COMPACTO.format(v)}
          />
          <Tooltip
            contentStyle={ESTILO_TOOLTIP}
            cursor={{ fill: "var(--hover)" }}
            labelFormatter={(v) => diaCorto(String(v))}
            formatter={(valor, nombre) => [
              nombre === "ahorroAcumulado" ? formatearDinero(Number(valor), moneda) : String(valor),
              NOMBRES[String(nombre)] ?? String(nombre),
            ]}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "var(--fg-secondary)" }}
            formatter={(nombre) => NOMBRES[String(nombre)] ?? String(nombre)}
          />
          <Bar
            yAxisId="encargos"
            dataKey="completados"
            name="completados"
            fill="var(--info)"
            fillOpacity={0.55}
            radius={[6, 6, 2, 2]}
            maxBarSize={28}
          />
          <Line
            yAxisId="ahorro"
            type="monotone"
            dataKey="ahorroAcumulado"
            name="ahorroAcumulado"
            stroke="var(--brand)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: "var(--brand)", stroke: "var(--s-raised)", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
