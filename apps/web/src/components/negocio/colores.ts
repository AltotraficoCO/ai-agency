/**
 * Paleta de series de las gráficas.
 *
 * Vive en su propio módulo —sin `"use client"`— porque la usan tanto las
 * gráficas del navegador como las leyendas y barras que se pintan en el
 * servidor. Un módulo de cliente no puede exportar constantes al servidor: lo
 * que llega al otro lado es una referencia, no el valor.
 *
 * Son variables CSS y no hexadecimales para que el cambio de tema las siga sin
 * que ningún componente tenga que enterarse. Y son SEIS: a partir de la séptima
 * serie nadie distingue ya cuál es cuál en una leyenda.
 */
export const SERIES = [
  "var(--brand)",
  "var(--human)",
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--fg-muted)",
] as const;
