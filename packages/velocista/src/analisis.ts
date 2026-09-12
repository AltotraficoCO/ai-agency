/**
 * El criterio del Velocista: qué es rápido, qué es lento y cómo se dice.
 *
 * Módulo puro, sin red y sin modelo. Está aparte porque es lo único que de
 * verdad se puede probar: si «tu web va lenta» dependiera de lo que el modelo
 * opine ese día, el mismo sitio sería rápido el lunes y lento el martes con las
 * mismas cifras.
 *
 * Los umbrales NO son nuestros: son los que usa Google para decidir si una
 * página pasa o no (verificados en septiembre de 2026). Se escriben aquí una
 * sola vez y se citan en el código, no en el prompt, porque un modelo que
 * recuerda umbrales de memoria se los inventa.
 *
 *   LCP  (se ve lo importante)   bien ≤ 2,5 s   ·  mal > 4 s
 *   INP  (responde al tocar)     bien ≤ 200 ms  ·  mal > 500 ms
 *   CLS  (no se mueve solo)      bien ≤ 0,1     ·  mal > 0,25
 *
 * Google los evalúa al percentil 75 de usuarios reales: tres de cada cuatro
 * visitas tienen que ir bien para que la página pase. Por eso, cuando hay datos
 * de gente real, esos mandan sobre los de laboratorio.
 */
import type { Campo, Dispositivo, Freno, Laboratorio, Medicion, Vitales } from "./ports.js";
import { NOMBRE_DISPOSITIVO } from "./ports.js";

export type Veredicto = "bien" | "regular" | "mal" | "sin_datos";

export type Metrica = "lcp" | "inp" | "cls";

/** Umbrales oficiales. `bien` es «hasta»; `mal` es «por encima de». */
export const UMBRALES: Readonly<Record<Metrica, { bien: number; mal: number }>> = {
  lcp: { bien: 2500, mal: 4000 },
  inp: { bien: 200, mal: 500 },
  cls: { bien: 0.1, mal: 0.25 },
};

export function clasificar(metrica: Metrica, valor: number | undefined): Veredicto {
  if (valor === undefined || !Number.isFinite(valor)) return "sin_datos";
  const u = UMBRALES[metrica];
  if (valor <= u.bien) return "bien";
  if (valor > u.mal) return "mal";
  return "regular";
}

/** El veredicto de una página es el de su métrica peor: pasa todo o no pasa. */
export function peorVeredicto(vitales: Vitales): Veredicto {
  const orden: Record<Veredicto, number> = { mal: 0, regular: 1, bien: 2, sin_datos: 3 };
  const veredictos: Veredicto[] = [
    clasificar("lcp", vitales.lcp),
    clasificar("inp", vitales.inp),
    clasificar("cls", vitales.cls),
  ].filter((v) => v !== "sin_datos");
  if (veredictos.length === 0) return "sin_datos";
  return veredictos.sort((a, b) => orden[a] - orden[b])[0] ?? "sin_datos";
}

// ---------------------------------------------------------------------------
// Cómo se escriben los números para que los entienda quien no es técnico
// ---------------------------------------------------------------------------

/** Segundos con una decimal y coma, como se escribe en español. */
export function segundos(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} segundos`;
}

export function milisegundos(ms: number): string {
  return `${Math.round(ms)} milisegundos`;
}

/** KB o MB, lo que se lea mejor. */
export function tamano(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * De dónde salió una cifra, dicho en una frase.
 *
 * Se escribe SIEMPRE junto al número. Un dueño de negocio que lee «tu web tarda
 * 5 segundos» y en su celular la ve abrir al instante deja de creerte; si lee
 * «según la gente que entró este mes», entiende de qué se habla.
 */
export function fuenteDe(origen: "campo" | "laboratorio", dispositivo: Dispositivo): string {
  return origen === "campo"
    ? `según la gente que entró de verdad desde su ${NOMBRE_DISPOSITIVO[dispositivo]}`
    : `medido en una prueba desde ${NOMBRE_DISPOSITIVO[dispositivo]}`;
}

/**
 * Lo que significa cada métrica, en una frase, con su cifra dentro.
 *
 * Nada de siglas: el cliente nunca lee «LCP» ni «CLS». Si el dato no está, se
 * devuelve null y el agente tiene prohibido rellenarlo.
 */
export function fraseDeMetrica(metrica: Metrica, valor: number | undefined): string | null {
  if (valor === undefined || !Number.isFinite(valor)) return null;
  const v = clasificar(metrica, valor);
  switch (metrica) {
    case "lcp": {
      const cuanto = segundos(valor);
      if (v === "bien") return `Tu página muestra lo importante en ${cuanto}, que está bien.`;
      if (v === "regular")
        return `Tu página tarda ${cuanto} en mostrar lo importante; lo bueno es menos de 2,5.`;
      return `Tu página tarda ${cuanto} en mostrar lo importante. Es mucho: lo bueno es menos de 2,5.`;
    }
    case "inp": {
      const cuanto = milisegundos(valor);
      if (v === "bien") return `Cuando alguien toca algo, responde en ${cuanto}: va suelta.`;
      if (v === "regular")
        return `Cuando alguien toca algo, tarda ${cuanto} en responder; lo bueno es menos de 200.`;
      return `Cuando alguien toca un botón, tarda ${cuanto} en responder. Se siente trabada.`;
    }
    case "cls": {
      const cuanto = valor.toFixed(2).replace(".", ",");
      if (v === "bien") return `La página casi no se mueve mientras carga (${cuanto}).`;
      if (v === "regular")
        return `La página se mueve un poco mientras carga (${cuanto}): a veces se toca lo que no era.`;
      return `La página se mueve sola mientras carga (${cuanto}): la gente termina tocando lo que no quería.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Traducir lo que dice la herramienta a lo que entiende el dueño del negocio
// ---------------------------------------------------------------------------

/**
 * Los frenos vienen con nombre técnico de la fuente. Esto los traduce y, sobre
 * todo, dice **quién puede arreglarlo**: hay cosas que se arreglan en WordPress
 * y cosas que son del hosting, y confundirlas hace perder dinero al cliente.
 */
export type FrenoLegible = {
  readonly clave: string;
  readonly titulo: string;
  readonly quePasa: string;
  readonly quienLoArregla: "nosotros" | "hosting" | "depende";
  readonly ahorroMs?: number;
  readonly ahorroBytes?: number;
};

const TRADUCCION: Readonly<
  Record<string, { quePasa: string; quienLoArregla: FrenoLegible["quienLoArregla"] }>
> = {
  "uses-optimized-images": {
    quePasa: "Hay imágenes más pesadas de lo que hace falta: se pueden comprimir sin que se vean peor.",
    quienLoArregla: "nosotros",
  },
  "modern-image-formats": {
    quePasa: "Las imágenes están en formatos viejos. En formatos nuevos pesan la mitad y se ven igual.",
    quienLoArregla: "nosotros",
  },
  "uses-responsive-images": {
    quePasa: "Se están descargando imágenes enormes para mostrarlas pequeñas.",
    quienLoArregla: "nosotros",
  },
  "offscreen-images": {
    quePasa: "Se cargan de golpe imágenes que están más abajo y que nadie ha visto todavía.",
    quienLoArregla: "nosotros",
  },
  "unused-javascript": {
    quePasa: "Se descarga código que esa página no usa. Suele venir de plugins que están en todas partes.",
    quienLoArregla: "nosotros",
  },
  "unused-css-rules": {
    quePasa: "Se descargan estilos que esa página no usa.",
    quienLoArregla: "nosotros",
  },
  "render-blocking-resources": {
    quePasa: "Hay archivos que se cargan antes que el contenido y hacen esperar a quien entra.",
    quienLoArregla: "nosotros",
  },
  "font-display": {
    quePasa: "El texto no se ve hasta que terminan de bajar las tipografías.",
    quienLoArregla: "nosotros",
  },
  "server-response-time": {
    quePasa: "El servidor tarda en contestar. Eso pasa antes de que la página empiece siquiera a cargar.",
    quienLoArregla: "hosting",
  },
  "uses-long-cache-ttl": {
    quePasa: "Quien ya visitó la página vuelve a descargarlo todo, en vez de reutilizar lo que ya tenía.",
    quienLoArregla: "nosotros",
  },
  "uses-text-compression": {
    quePasa: "Los archivos de texto viajan sin comprimir: pesan varias veces lo que deberían.",
    quienLoArregla: "hosting",
  },
  "total-byte-weight": {
    quePasa: "La página entera pesa demasiado para una conexión de celular.",
    quienLoArregla: "depende",
  },
  redirects: {
    quePasa: "La dirección rebota de una página a otra antes de llegar, y cada salto se paga en tiempo.",
    quienLoArregla: "depende",
  },
};

export function traducirFreno(freno: Freno): FrenoLegible {
  const t = TRADUCCION[freno.clave];
  return {
    clave: freno.clave,
    titulo: freno.titulo,
    quePasa: t?.quePasa ?? freno.titulo,
    quienLoArregla: t?.quienLoArregla ?? "depende",
    ...(freno.ahorroMs !== undefined ? { ahorroMs: freno.ahorroMs } : {}),
    ...(freno.ahorroBytes !== undefined ? { ahorroBytes: freno.ahorroBytes } : {}),
  };
}

/** Los frenos que más tiempo ahorran, traducidos y ordenados. */
export function frenosQueImportan(frenos: readonly Freno[], cuantos = 5): readonly FrenoLegible[] {
  return [...frenos]
    .filter((f) => (f.ahorroMs ?? 0) > 0 || (f.ahorroBytes ?? 0) > 0)
    .sort((a, b) => (b.ahorroMs ?? 0) - (a.ahorroMs ?? 0))
    .slice(0, cuantos)
    .map(traducirFreno);
}

// ---------------------------------------------------------------------------
// El diagnóstico de una página
// ---------------------------------------------------------------------------

export type Diagnostico = {
  readonly url: string;
  readonly dispositivo: Dispositivo;
  readonly veredicto: Veredicto;
  /** De dónde sale el veredicto: manda la gente real si la hay. */
  readonly origen: "campo" | "laboratorio";
  /** Una o dos frases, sin siglas, con las cifras dentro. */
  readonly frases: readonly string[];
  readonly frenos: readonly FrenoLegible[];
  /** Avisos honestos: lo que no se pudo medir y por qué. */
  readonly avisos: readonly string[];
};

export function diagnosticar(medicion: Medicion): Diagnostico {
  const hayCampo = medicion.campo !== undefined && peorVeredicto(medicion.campo) !== "sin_datos";
  const origen: "campo" | "laboratorio" = hayCampo ? "campo" : "laboratorio";
  const vitales: Vitales = hayCampo ? (medicion.campo as Campo) : medicion.laboratorio;

  const frases: string[] = [];
  const avisos: string[] = [];
  const fuente = fuenteDe(origen, medicion.dispositivo);

  for (const metrica of ["lcp", "inp", "cls"] as const) {
    const frase = fraseDeMetrica(metrica, vitales[metrica]);
    if (frase) frases.push(`${frase} (${fuente})`);
  }

  if (!hayCampo) {
    avisos.push(
      "No hay datos de visitantes reales para esta página todavía: Google solo los publica cuando entra suficiente gente. Lo de arriba es una prueba, no lo que vive tu cliente.",
    );
    if (medicion.laboratorio.tbt !== undefined) {
      avisos.push(
        `Tampoco se puede saber si la página responde rápido al tocarla: eso solo se mide con gente real. En la prueba estuvo bloqueada ${milisegundos(medicion.laboratorio.tbt)}.`,
      );
    }
  }

  const frenos = frenosQueImportan(medicion.frenos);

  // Lo que no se arregla desde WordPress se dice SIEMPRE, y se dice aquí.
  // Si el cliente no lee esto, paga por optimizar imágenes un sitio cuyo
  // problema es el servidor, y al final del trabajo sigue igual de lento.
  const delHosting = frenos.filter((f) => f.quienLoArregla === "hosting");
  if (delHosting.length > 0) {
    const tarda =
      medicion.laboratorio.ttfb !== undefined
        ? ` El servidor tardó ${milisegundos(medicion.laboratorio.ttfb)} en contestar.`
        : "";
    avisos.push(
      `Hay algo que no se arregla desde WordPress y es cosa del hosting: ${delHosting
        .map((f) => f.quePasa.toLowerCase())
        .join(" ")}${tarda}`,
    );
  }

  return {
    url: medicion.url,
    dispositivo: medicion.dispositivo,
    veredicto: peorVeredicto(vitales),
    origen,
    frases,
    frenos,
    avisos,
  };
}

/** Una línea para encabezar el diagnóstico, sin adornos. */
export function titularDe(d: Diagnostico): string {
  const donde = NOMBRE_DISPOSITIVO[d.dispositivo];
  switch (d.veredicto) {
    case "bien":
      return `Tu página va bien en ${donde}.`;
    case "regular":
      return `Tu página va regular en ${donde}: se puede mejorar.`;
    case "mal":
      return `Tu página va lenta en ${donde}.`;
    case "sin_datos":
      return `No pude medir tu página en ${donde}.`;
  }
}

// ---------------------------------------------------------------------------
// El antes y el después: lo que hace bueno a este agente
// ---------------------------------------------------------------------------

export type Comparacion = {
  readonly url: string;
  readonly dispositivo: Dispositivo;
  readonly mejoro: boolean;
  /** Diferencia en el tiempo hasta ver lo importante, en ms. Negativo = mejoró. */
  readonly diferenciaLcp?: number;
  readonly frase: string;
};

/**
 * Compara dos mediciones de la MISMA página y dispositivo.
 *
 * Regla dura: solo se compara laboratorio con laboratorio. Los datos de gente
 * real son de los últimos 28 días, así que un arreglo de hace diez minutos no
 * se refleja ahí todavía; presentarlo como mejora sería mentir con datos
 * ciertos.
 */
export function comparar(antes: Medicion, despues: Medicion): Comparacion {
  const a = antes.laboratorio.lcp;
  const d = despues.laboratorio.lcp;
  if (a === undefined || d === undefined) {
    return {
      url: despues.url,
      dispositivo: despues.dispositivo,
      mejoro: false,
      frase: "No pude comparar: falta la medición de antes o la de después.",
    };
  }
  const diferencia = d - a;
  const donde = NOMBRE_DISPOSITIVO[despues.dispositivo];
  if (Math.abs(diferencia) < 150) {
    return {
      url: despues.url,
      dispositivo: despues.dispositivo,
      mejoro: false,
      diferenciaLcp: diferencia,
      frase: `En ${donde} quedó prácticamente igual: ${segundos(a)} antes y ${segundos(d)} ahora. Lo digo tal cual: no todo cambio se nota.`,
    };
  }
  if (diferencia < 0) {
    return {
      url: despues.url,
      dispositivo: despues.dispositivo,
      mejoro: true,
      diferenciaLcp: diferencia,
      frase: `En ${donde} pasó de ${segundos(a)} a ${segundos(d)}: ${segundos(Math.abs(diferencia))} menos de espera para quien entra.`,
    };
  }
  return {
    url: despues.url,
    dispositivo: despues.dispositivo,
    mejoro: false,
    diferenciaLcp: diferencia,
    frase: `En ${donde} quedó más lenta que antes: ${segundos(a)} antes y ${segundos(d)} ahora. Hay que revisar qué cambió.`,
  };
}

// ---------------------------------------------------------------------------
// Imágenes y plugins: lo que se puede mirar sin medir
// ---------------------------------------------------------------------------

/** A partir de aquí una imagen es «pesada» para una página web. */
export const BYTES_IMAGEN_PESADA = 300 * 1024;
/** Ancho por encima del cual una imagen está desproporcionada para la web. */
export const ANCHO_EXAGERADO = 2200;
/** Formatos que hoy pesan el doble que uno moderno. */
export const FORMATOS_VIEJOS = ["image/jpeg", "image/jpg", "image/png"];

export type ImagenPesada = {
  readonly id: number;
  readonly titulo: string;
  readonly url: string;
  readonly bytes?: number;
  readonly motivo: string;
};

export function imagenesPesadas(
  imagenes: readonly {
    id: number;
    url: string;
    titulo: string;
    bytes?: number;
    mime?: string;
    ancho?: number;
  }[],
  cuantas = 10,
): readonly ImagenPesada[] {
  const encontradas: ImagenPesada[] = [];
  for (const img of imagenes) {
    const motivos: string[] = [];
    if (img.bytes !== undefined && img.bytes >= BYTES_IMAGEN_PESADA) {
      motivos.push(`pesa ${tamano(img.bytes)}`);
    }
    if (img.ancho !== undefined && img.ancho > ANCHO_EXAGERADO) {
      motivos.push(`mide ${img.ancho} puntos de ancho, mucho más de lo que se ve en pantalla`);
    }
    if (img.mime && FORMATOS_VIEJOS.includes(img.mime.toLowerCase()) && (img.bytes ?? 0) >= 150 * 1024) {
      motivos.push("está en un formato viejo que pesa el doble");
    }
    if (motivos.length === 0) continue;
    encontradas.push({
      id: img.id,
      titulo: img.titulo,
      url: img.url,
      ...(img.bytes !== undefined ? { bytes: img.bytes } : {}),
      motivo: motivos.join(" y "),
    });
  }
  return encontradas.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, cuantas);
}

/** Cuánto se descarga de más por culpa de las imágenes pesadas. */
export function pesoDeMas(imagenes: readonly ImagenPesada[]): number {
  return imagenes.reduce((s, i) => s + Math.max(0, (i.bytes ?? 0) - BYTES_IMAGEN_PESADA), 0);
}

/** Plugins de caché conocidos, por orden de preferencia para WordPress. */
export const PLUGINS_DE_CACHE = [
  { slug: "litespeed-cache", nombre: "LiteSpeed Cache" },
  { slug: "w3-total-cache", nombre: "W3 Total Cache" },
  { slug: "wp-super-cache", nombre: "WP Super Cache" },
  { slug: "cache-enabler", nombre: "Cache Enabler" },
] as const;

export function tieneCache(plugins: readonly { slug: string; activo: boolean }[]): {
  readonly activo: boolean;
  readonly cual?: string;
} {
  const conocidos = new Set<string>(PLUGINS_DE_CACHE.map((p) => p.slug));
  const encontrado = plugins.find((p) => conocidos.has(p.slug) && p.activo);
  return encontrado ? { activo: true, cual: encontrado.slug } : { activo: false };
}
