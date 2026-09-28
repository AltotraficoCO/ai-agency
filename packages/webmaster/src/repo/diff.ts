/**
 * Diff unificado de dos textos, para que el agente —y el PR— enseñen
 * exactamente qué cambió. Recorta lo común por delante y por detrás y hace LCS
 * solo con el medio; si el medio es enorme, lo da como un bloque reemplazado.
 */

type Op = { tipo: " " | "-" | "+"; linea: string };

const TOPE_CELDAS = 4_000_000;

function operaciones(a: readonly string[], b: readonly string[]): Op[] {
  let inicio = 0;
  while (inicio < a.length && inicio < b.length && a[inicio] === b[inicio]) inicio++;
  let finA = a.length;
  let finB = b.length;
  while (finA > inicio && finB > inicio && a[finA - 1] === b[finB - 1]) {
    finA--;
    finB--;
  }
  const ops: Op[] = a.slice(0, inicio).map((linea) => ({ tipo: " ", linea }));
  const medioA = a.slice(inicio, finA);
  const medioB = b.slice(inicio, finB);

  if (medioA.length * medioB.length > TOPE_CELDAS) {
    ops.push(...medioA.map((linea) => ({ tipo: "-" as const, linea })));
    ops.push(...medioB.map((linea) => ({ tipo: "+" as const, linea })));
  } else {
    const n = medioA.length;
    const m = medioB.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let x = n - 1; x >= 0; x--) {
      for (let y = m - 1; y >= 0; y--) {
        lcs[x]![y] = medioA[x] === medioB[y] ? lcs[x + 1]![y + 1]! + 1 : Math.max(lcs[x + 1]![y]!, lcs[x]![y + 1]!);
      }
    }
    let x = 0;
    let y = 0;
    while (x < n && y < m) {
      if (medioA[x] === medioB[y]) {
        ops.push({ tipo: " ", linea: medioA[x]! });
        x++;
        y++;
      } else if (lcs[x + 1]![y]! >= lcs[x]![y + 1]!) {
        ops.push({ tipo: "-", linea: medioA[x++]! });
      } else {
        ops.push({ tipo: "+", linea: medioB[y++]! });
      }
    }
    while (x < n) ops.push({ tipo: "-", linea: medioA[x++]! });
    while (y < m) ops.push({ tipo: "+", linea: medioB[y++]! });
  }

  ops.push(...a.slice(finA).map((linea) => ({ tipo: " " as const, linea })));
  return ops;
}

/** Diff unificado con `contexto` líneas alrededor de cada cambio. Vacío si son iguales. */
export function diffUnificado(ruta: string, antes: string | null, despues: string | null, contexto = 3): string {
  if (antes === despues) return "";
  const a = antes === null ? [] : antes.split("\n");
  const b = despues === null ? [] : despues.split("\n");
  const ops = operaciones(a, b);

  const cambios = ops.map((o, i) => (o.tipo === " " ? -1 : i)).filter((i) => i >= 0);
  if (cambios.length === 0) return "";

  // Agrupa los cambios que quedan a menos de 2·contexto en un mismo bloque.
  const bloques: [number, number][] = [];
  for (const i of cambios) {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && i - ultimo[1] <= contexto * 2) ultimo[1] = i;
    else bloques.push([i, i]);
  }

  const salida = [`--- ${antes === null ? "/dev/null" : `a/${ruta}`}`, `+++ ${despues === null ? "/dev/null" : `b/${ruta}`}`];
  // Número de línea en a y en b al empezar cada op.
  const lineaA: number[] = [];
  const lineaB: number[] = [];
  let la = 1;
  let lb = 1;
  for (const o of ops) {
    lineaA.push(la);
    lineaB.push(lb);
    if (o.tipo !== "+") la++;
    if (o.tipo !== "-") lb++;
  }

  for (const [desde, hasta] of bloques) {
    const ini = Math.max(0, desde - contexto);
    const fin = Math.min(ops.length - 1, hasta + contexto);
    const trozo = ops.slice(ini, fin + 1);
    const cuentaA = trozo.filter((o) => o.tipo !== "+").length;
    const cuentaB = trozo.filter((o) => o.tipo !== "-").length;
    salida.push(`@@ -${cuentaA ? lineaA[ini] : lineaA[ini]! - 1},${cuentaA} +${cuentaB ? lineaB[ini] : lineaB[ini]! - 1},${cuentaB} @@`);
    for (const o of trozo) salida.push(`${o.tipo}${o.linea}`);
  }
  return salida.join("\n");
}

/** Líneas añadidas y quitadas, para los resúmenes. */
export function contarCambios(antes: string | null, despues: string | null): { mas: number; menos: number } {
  const ops = operaciones(antes === null ? [] : antes.split("\n"), despues === null ? [] : despues.split("\n"));
  return {
    mas: ops.filter((o) => o.tipo === "+").length,
    menos: ops.filter((o) => o.tipo === "-").length,
  };
}
