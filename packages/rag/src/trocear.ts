/**
 * Troceado semántico.
 *
 * Tres reglas, por orden de importancia:
 *  1. No partir nunca una tabla ni una lista. Media tabla de precios recuperada
 *     es peor que no recuperar nada: el agente cita un precio truncado.
 *  2. Cada trozo arrastra su ruta de encabezados ("Precios > Plan Pro")
 *     antepuesta al texto indexado. Cuesta veinte tokens y arregla el caso en
 *     que el trozo dice "cuesta 90.000" sin decir de qué.
 *  3. Objetivo 700-900 tokens con ~120 de solapamiento, para que una frase que
 *     cae en la costura siga apareciendo entera en uno de los dos trozos.
 */
import { dividirEnFrases, estimarTokens, hashContenido, limpiarMarkdown } from "./texto.js";
import type { Trozo } from "./types.js";

export type OpcionesTroceado = {
  readonly objetivoMinimo: number;
  readonly objetivoMaximo: number;
  readonly solapamiento: number;
  /** Un bloque más grande que esto se parte aunque sea una lista. */
  readonly maximoAbsoluto: number;
};

export const TROCEADO_POR_DEFECTO: OpcionesTroceado = {
  objetivoMinimo: 700,
  objetivoMaximo: 900,
  solapamiento: 120,
  maximoAbsoluto: 2400,
};

type TipoBloque = "encabezado" | "parrafo" | "lista" | "tabla" | "codigo" | "cita";

type Bloque = {
  readonly tipo: TipoBloque;
  readonly texto: string;
  readonly tokens: number;
  /** Solo en encabezados. */
  readonly nivel?: number;
  /** Ruta de encabezados vigente al empezar este bloque. */
  readonly ruta: readonly string[];
};

const RE_ENCABEZADO = /^(#{1,6})\s+(.*)$/;
const RE_LISTA = /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/;
const RE_TABLA = /^\s{0,3}\|/;
const RE_CITA = /^\s{0,3}>\s?/;
const RE_VALLA = /^\s{0,3}(```|~~~)/;

/**
 * Parte el markdown en bloques atómicos. Una lista completa es UN bloque, y
 * una tabla completa también: a partir de aquí el troceador solo agrupa
 * bloques, así que la regla 1 se cumple por construcción.
 */
export function partirEnBloques(markdown: string): Bloque[] {
  const lineas = limpiarMarkdown(markdown).split("\n");
  const bloques: Bloque[] = [];
  let ruta: string[] = [];
  let i = 0;

  const empujar = (tipo: TipoBloque, lineasBloque: string[], nivel?: number): void => {
    const texto = lineasBloque.join("\n").trim();
    if (texto === "") return;
    bloques.push({
      tipo,
      texto,
      tokens: estimarTokens(texto),
      ruta: [...ruta],
      ...(nivel !== undefined ? { nivel } : {}),
    });
  };

  while (i < lineas.length) {
    const linea = lineas[i] ?? "";

    if (linea.trim() === "") {
      i += 1;
      continue;
    }

    const enc = RE_ENCABEZADO.exec(linea);
    if (enc) {
      const nivel = (enc[1] ?? "#").length;
      const titulo = (enc[2] ?? "").trim();
      // La ruta se actualiza ANTES de emitir: el propio encabezado forma parte
      // del contexto del contenido que lo sigue.
      ruta = [...ruta.slice(0, nivel - 1), titulo];
      empujar("encabezado", [linea], nivel);
      i += 1;
      continue;
    }

    if (RE_VALLA.test(linea)) {
      const valla = (RE_VALLA.exec(linea)?.[1] ?? "```");
      const acc = [linea];
      i += 1;
      while (i < lineas.length) {
        const l = lineas[i] ?? "";
        acc.push(l);
        i += 1;
        if (l.trimStart().startsWith(valla)) break;
      }
      empujar("codigo", acc);
      continue;
    }

    if (RE_TABLA.test(linea)) {
      const acc: string[] = [];
      while (i < lineas.length && RE_TABLA.test(lineas[i] ?? "")) {
        acc.push(lineas[i] ?? "");
        i += 1;
      }
      empujar("tabla", acc);
      continue;
    }

    if (RE_LISTA.test(linea)) {
      const acc: string[] = [];
      // Una línea en blanco suelta dentro de una lista no la termina: solo la
      // corta una línea en blanco seguida de algo que ya no es lista.
      while (i < lineas.length) {
        const l = lineas[i] ?? "";
        if (l.trim() === "") {
          const siguiente = lineas[i + 1] ?? "";
          if (!RE_LISTA.test(siguiente) && !/^\s{2,}\S/.test(siguiente)) break;
          acc.push(l);
          i += 1;
          continue;
        }
        if (!RE_LISTA.test(l) && !/^\s{2,}\S/.test(l)) break;
        acc.push(l);
        i += 1;
      }
      empujar("lista", acc);
      continue;
    }

    if (RE_CITA.test(linea)) {
      const acc: string[] = [];
      while (i < lineas.length && RE_CITA.test(lineas[i] ?? "")) {
        acc.push(lineas[i] ?? "");
        i += 1;
      }
      empujar("cita", acc);
      continue;
    }

    const acc: string[] = [];
    while (i < lineas.length) {
      const l = lineas[i] ?? "";
      if (
        l.trim() === "" ||
        RE_ENCABEZADO.test(l) ||
        RE_TABLA.test(l) ||
        RE_LISTA.test(l) ||
        RE_CITA.test(l) ||
        RE_VALLA.test(l)
      ) {
        break;
      }
      acc.push(l);
      i += 1;
    }
    empujar("parrafo", acc);
  }

  return bloques;
}

/** "Precios > Plan Pro" */
export function formatearRuta(ruta: readonly string[]): string {
  return ruta.filter((r) => r.trim() !== "").join(" > ");
}

/** Prefija la ruta de encabezados al texto que se va a indexar. */
export function componerContenido(ruta: readonly string[], texto: string): string {
  const cabecera = formatearRuta(ruta);
  return cabecera === "" ? texto : `${cabecera}\n\n${texto}`;
}

/**
 * Un bloque enorme e indivisible (una tabla de 400 filas) se deja entero
 * mientras no supere `maximoAbsoluto`. Pasado ese punto ya no cabe en ninguna
 * ventana y hay que partirlo; se hace por filas o por elementos, nunca a
 * mitad de una línea.
 */
function partirBloqueGigante(bloque: Bloque, opts: OpcionesTroceado): Bloque[] {
  if (bloque.tokens <= opts.maximoAbsoluto) return [bloque];

  const unidades =
    bloque.tipo === "parrafo" ? dividirEnFrases(bloque.texto) : bloque.texto.split("\n");
  // En una tabla la fila de cabecera se repite en cada pedazo: sin ella las
  // columnas del segundo pedazo no significan nada.
  const cabeceraTabla =
    bloque.tipo === "tabla" ? unidades.slice(0, 2).join("\n") : "";

  const partes: Bloque[] = [];
  let acc: string[] = [];
  let tokens = 0;
  const cerrar = (): void => {
    if (acc.length === 0) return;
    const cuerpo = acc.join(bloque.tipo === "parrafo" ? " " : "\n");
    const texto = cabeceraTabla && partes.length > 0 ? `${cabeceraTabla}\n${cuerpo}` : cuerpo;
    partes.push({ tipo: bloque.tipo, texto, tokens: estimarTokens(texto), ruta: bloque.ruta });
    acc = [];
    tokens = 0;
  };

  const desde = bloque.tipo === "tabla" ? 2 : 0;
  if (bloque.tipo === "tabla") acc.push(cabeceraTabla);
  for (let u = desde; u < unidades.length; u++) {
    const unidad = unidades[u] ?? "";
    const t = estimarTokens(unidad);
    if (tokens + t > opts.objetivoMaximo && acc.length > 0) cerrar();
    acc.push(unidad);
    tokens += t;
  }
  cerrar();
  return partes.length > 0 ? partes : [bloque];
}

/**
 * Solapamiento: se arrastran bloques completos del final del trozo anterior
 * mientras quepan en ~120 tokens. Nunca se arrastra media tabla ni media
 * lista; si el último bloque no cabe entero, se arrastran sus últimas frases
 * (solo si es prosa) o no se arrastra nada.
 */
function calcularSolapamiento(previos: readonly Bloque[], opts: OpcionesTroceado): Bloque[] {
  const arrastre: Bloque[] = [];
  let tokens = 0;
  for (let i = previos.length - 1; i >= 0; i--) {
    const b = previos[i];
    if (!b) break;
    if (b.tipo === "encabezado") continue;
    if (tokens + b.tokens <= opts.solapamiento) {
      arrastre.unshift(b);
      tokens += b.tokens;
      continue;
    }
    if (arrastre.length === 0 && b.tipo === "parrafo") {
      const frases = dividirEnFrases(b.texto);
      const cola: string[] = [];
      let t = 0;
      for (let f = frases.length - 1; f >= 0; f--) {
        const frase = frases[f] ?? "";
        const tf = estimarTokens(frase);
        if (t + tf > opts.solapamiento) break;
        cola.unshift(frase);
        t += tf;
      }
      if (cola.length > 0) {
        const texto = cola.join(" ");
        arrastre.unshift({ tipo: "parrafo", texto, tokens: estimarTokens(texto), ruta: b.ruta });
      }
    }
    break;
  }
  return arrastre;
}

export function trocear(markdown: string, opciones?: Partial<OpcionesTroceado>): Trozo[] {
  const opts = { ...TROCEADO_POR_DEFECTO, ...opciones };
  const bloques = partirEnBloques(markdown).flatMap((b) => partirBloqueGigante(b, opts));
  if (bloques.length === 0) return [];

  const trozos: Trozo[] = [];
  let actuales: Bloque[] = [];
  let tokens = 0;

  const cerrar = (): void => {
    // Un trozo que solo contiene encabezados no aporta nada: se descarta salvo
    // que el documento entero sea eso.
    const hayContenido = actuales.some((b) => b.tipo !== "encabezado");
    if (!hayContenido && trozos.length > 0) {
      actuales = [];
      tokens = 0;
      return;
    }
    const texto = actuales.map((b) => b.texto).join("\n\n").trim();
    if (texto === "") {
      actuales = [];
      tokens = 0;
      return;
    }
    // La ruta del trozo es la del primer bloque con contenido, no la del
    // encabezado que lo abre: un trozo que empieza en "# Precios / ## Plan Pro"
    // pertenece a "Precios > Plan Pro", no a "Precios".
    const ruta = (actuales.find((b) => b.tipo !== "encabezado") ?? actuales[0])?.ruta ?? [];
    const contenido = componerContenido(ruta, texto);
    trozos.push({
      posicion: trozos.length,
      contenido,
      texto,
      rutaEncabezados: ruta,
      tokensEstimados: estimarTokens(contenido),
      hash: hashContenido(contenido),
    });
    const arrastre = calcularSolapamiento(actuales, opts);
    actuales = [...arrastre];
    tokens = arrastre.reduce((s, b) => s + b.tokens, 0);
  };

  for (const bloque of bloques) {
    // Un encabezado de nivel alto abre sección: si ya hay suficiente material
    // acumulado, se corta ahí, que es la costura natural del documento.
    if (
      bloque.tipo === "encabezado" &&
      (bloque.nivel ?? 6) <= 3 &&
      tokens >= opts.objetivoMinimo
    ) {
      cerrar();
    }
    if (tokens + bloque.tokens > opts.objetivoMaximo && tokens >= opts.objetivoMinimo) {
      cerrar();
    }
    // Aquí está la regla 1: si el bloque no cabe pero es indivisible, se mete
    // igual y el trozo se pasa del objetivo. Preferimos un trozo grande a una
    // tabla partida.
    actuales.push(bloque);
    tokens += bloque.tokens;
  }
  cerrar();

  return trozos.map((t, i) => (t.posicion === i ? t : { ...t, posicion: i }));
}
