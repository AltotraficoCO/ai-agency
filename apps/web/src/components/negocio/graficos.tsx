"use client";

/**
 * Las gráficas del producto.
 *
 * REGLAS, y son del sistema de diseño, no gustos:
 *   · Recharts, y solo Recharts.
 *   · Los colores salen de las variables CSS del tema (`var(--brand)`,
 *     `var(--human)`…). Un hexadecimal escrito aquí se vería mal en el otro
 *     tema el día que alguien cambie la paleta.
 *   · Máximo 6 series. Con siete, nadie distingue ya cuál es cuál.
 *   · Ejes a 11px (`--text-2xs`).
 *   · Sin gradientes salvo el área bajo la línea principal.
 *   · Toda gráfica lleva su tabla equivalente al lado (`VerComoTabla`), que se
 *     compone fuera, en el servidor.
 *
 * El índigo es la IA y el fucsia el humano en TODO el producto. En la gráfica
 * de atención eso significa que, de un vistazo, el bloque índigo es lo que el
 * agente resolvió solo: es literalmente la métrica de negocio del producto.
 */
import * as React from "react";
import {
  Area,
  AreaChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SERIES } from "./colores";

const EJE = { fontSize: 11, fill: "var(--fg-muted)" } as const;

const ESTILO_TOOLTIP = {
  backgroundColor: "var(--s-overlay)",
  border: "1px solid var(--border-default)",
  borderRadius: "10px",
  fontSize: "13px",
  color: "var(--fg-default)",
  boxShadow: "var(--shadow-2)",
} as const;

function diaCorto(dia: string): string {
  const fecha = new Date(`${dia}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(fecha);
}

// ── IA vs. humano ───────────────────────────────────────────────────────────

export type PuntoAtencionUI = { dia: string; ia: number; humano: number };

export function GraficoAtencion({ datos }: { datos: readonly PuntoAtencionUI[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={datos as PuntoAtencionUI[]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {/* El único gradiente permitido: el área bajo la serie principal. */}
            <linearGradient id="areaIa" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dia"
            tick={EJE}
            tickLine={false}
            axisLine={{ stroke: "var(--border-subtle)" }}
            tickFormatter={diaCorto}
            minTickGap={24}
          />
          <YAxis tick={EJE} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip
            contentStyle={ESTILO_TOOLTIP}
            labelFormatter={(v) => diaCorto(String(v))}
            formatter={(valor, nombre) => [
              String(valor),
              nombre === "ia" ? "Resueltas por la IA" : "Pasadas a una persona",
            ]}
          />
          <Area
            type="monotone"
            dataKey="ia"
            stackId="1"
            stroke="var(--brand)"
            strokeWidth={2}
            fill="url(#areaIa)"
            name="ia"
          />
          <Area
            type="monotone"
            dataKey="humano"
            stackId="1"
            stroke="var(--human)"
            strokeWidth={2}
            fill="var(--human)"
            fillOpacity={0.28}
            name="humano"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Cómo terminaron ─────────────────────────────────────────────────────────

export type PorcionUI = { etiqueta: string; valor: number };

export function GraficoDesenlaces({ datos }: { datos: readonly PorcionUI[] }) {
  const visibles = datos.slice(0, SERIES.length);
  const total = visibles.reduce((s, d) => s + d.valor, 0);

  return (
    <div className="flex items-center gap-4">
      <div className="h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visibles as PorcionUI[]}
              dataKey="valor"
              nameKey="etiqueta"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--s-raised)"
              strokeWidth={2}
            >
              {visibles.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={ESTILO_TOOLTIP} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5 text-sm">
        {visibles.map((d, i) => (
          <li key={d.etiqueta} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SERIES[i % SERIES.length] }}
            />
            <span className="truncate text-fg-secondary">{d.etiqueta}</span>
            <span className="ml-auto tabular-nums text-fg">
              {total > 0 ? `${Math.round((d.valor / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Minigráfico de fila ─────────────────────────────────────────────────────

/**
 * Sparkline de la tabla de rendimiento. Sin ejes ni tooltip: en 100×24 píxeles
 * lo único legible es la FORMA, y añadirle adornos la emborrona.
 */
export function Minigrafico({ serie, titulo }: { serie: readonly number[]; titulo: string }) {
  const datos = React.useMemo(() => serie.map((v, i) => ({ i, v })), [serie]);
  if (serie.length === 0) return <span className="text-fg-muted">—</span>;
  return (
    <div className="h-6 w-24" role="img" aria-label={titulo}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={datos} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="var(--brand)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
