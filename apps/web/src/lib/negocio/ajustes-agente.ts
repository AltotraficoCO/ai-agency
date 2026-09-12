/**
 * Lo que el cliente responde al contratar, convertido en instrucciones.
 *
 * El asistente guardaba las respuestas en `agent_subscriptions.settings` y
 * **nadie las leía**: ningún adaptador del worker consulta ese campo. Preguntar
 * cuatro cosas y no usar ninguna es peor que no preguntar, porque el cliente
 * cree que configuró algo.
 *
 * En vez de llevar los ajustes hasta el worker por un camino nuevo, se escriben
 * en la ficha de instrucciones del agente, que ya se crea al contratar y ya se
 * compila en su prompt. Dos ventajas sobre el camino largo: llegan al agente
 * sin tocar el worker, y el cliente **los ve y los puede corregir** en la
 * pantalla de Instrucciones, en vez de quedar escondidos en una tabla.
 *
 * Lo que habilita va a «Qué hace»; lo que restringe, a «Qué no debe hacer».
 * Una respuesta que no cambia el comportamiento no genera frase: el prompt es
 * caro y una línea que no manda nada solo distrae al modelo.
 *
 * Módulo puro: sin base de datos, para poder probarlo.
 */

export type InstruccionesDeAjustes = {
  readonly hace: readonly string[];
  readonly noHace: readonly string[];
};

const VACIO: InstruccionesDeAjustes = { hace: [], noHace: [] };

/** Un texto libre del cliente, en una línea y sin comillas que rompan el prompt. */
function enUnaLinea(valor: string): string {
  return valor.replace(/\s+/g, " ").replace(/["«»]/g, "").trim();
}

type Traductor = (valor: string) => InstruccionesDeAjustes | null;

/**
 * Qué frase genera cada respuesta, por agente y por campo.
 *
 * Las claves son las de `CAMPOS_POR_AGENTE`. Si un campo no está aquí, su
 * respuesta no se escribe: se prefiere callar a inventarle una regla al agente.
 */
const TRADUCTORES: Record<string, Record<string, Traductor>> = {
  administrativo: {
    dias_atraso: (v) => {
      const dias = Number.parseInt(v, 10);
      if (!Number.isFinite(dias) || dias <= 0) return null;
      return {
        hace: [`Persigues una factura cuando lleva ${dias} días o más de atraso.`],
        noHace: [],
      };
    },
    puede_emitir: (v) =>
      v === "emitir"
        ? { hace: ["Emites facturas y registras pagos cuando el cliente aprueba la propuesta."], noHace: [] }
        : {
            hace: ["Dejas las facturas preparadas para que el cliente las revise."],
            noHace: ["No emites ninguna factura, ni siquiera aprobada: el cliente la emite."],
          },
    impuesto: (v) => {
      if (v === "iva19") return { hace: ["Salvo que te digan otra cosa, las facturas llevan IVA del 19%."], noHace: [] };
      if (v === "exento") return { hace: ["Salvo que te digan otra cosa, las facturas van sin IVA."], noHace: [] };
      if (v === "preguntar")
        return { hace: ["Preguntas qué impuesto lleva la factura antes de prepararla."], noHace: [] };
      return null;
    },
    cuenta_cobro: (v) => {
      const cuenta = enUnaLinea(v);
      if (!cuenta) return null;
      return { hace: [`Los pagos que entran se anotan en la cuenta «${cuenta}».`], noHace: [] };
    },
  },
  reportes: {
    dia_informe: (v) => {
      const cuando =
        v === "viernes" ? "los viernes" : v === "dia1" ? "el día 1 de cada mes" : v === "lunes" ? "los lunes" : "";
      return cuando ? { hace: [`El informe se entrega ${cuando}.`], noHace: [] } : null;
    },
    periodo: (v) => {
      const dias = Number.parseInt(v, 10);
      if (!Number.isFinite(dias) || dias <= 0) return null;
      return { hace: [`Cada informe mira los últimos ${dias} días.`], noHace: [] };
    },
  },
  velocista: {
    paginas_clave: (v) => {
      const paginas = v
        .split("\n")
        .map((p) => enUnaLinea(p))
        .filter((p) => p.length > 0);
      if (paginas.length === 0) return null;
      return {
        hace: [`Además de la portada, mides estas páginas: ${paginas.join(", ")}.`],
        noHace: [],
      };
    },
    puede_instalar: (v) =>
      v === "instalar"
        ? { hace: ["Puedes instalar la caché cuando el cliente lo apruebe."], noHace: [] }
        : {
            hace: ["Mides, explicas qué frena el sitio y propones el arreglo."],
            noHace: ["No instalas ni activas nada en la web: eso lo decide el cliente."],
          },
  },
  disenador: {
    estilo: (v) => {
      const estilo =
        v === "marca"
          ? "con los colores y el aire de la web del cliente"
          : v === "fotografico"
            ? "con aspecto fotográfico"
            : v === "ilustracion"
              ? "como ilustraciones"
              : v === "minimalista"
                ? "en un estilo minimalista, sin adornos"
                : "";
      return estilo ? { hace: [`Las piezas que haces son ${estilo}.`], noHace: [] } : null;
    },
    puede_publicar: (v) =>
      v === "subir"
        ? { hace: ["Puedes subir las imágenes al sitio cuando el cliente lo apruebe."], noHace: [] }
        : {
            hace: ["Entregas las imágenes al cliente para que él decida dónde van."],
            noHace: ["No subes imágenes al sitio."],
          },
  },
  marketing: {
    objetivo: (v) => {
      const objetivo =
        v === "captar"
          ? "captar clientes nuevos"
          : v === "recuperar"
            ? "recuperar clientes que dejaron de comprar"
            : v === "fidelizar"
              ? "que los clientes actuales compren más"
              : "";
      return objetivo ? { hace: [`Lo que escribes y propones busca ${objetivo}.`], noHace: [] } : null;
    },
    tono: (v) => {
      const tono = v === "cercano" ? "cercano" : v === "neutro" ? "neutro" : v === "formal" ? "formal" : "";
      return tono ? { hace: [`Escribes en tono ${tono}.`], noHace: [] } : null;
    },
    no_mencionar: (v) => {
      const temas = enUnaLinea(v);
      return temas ? { hace: [], noHace: [`No mencionas nunca: ${temas}.`] } : null;
    },
  },
  webmaster: {
    frecuencia: (v) => {
      const cada = v === "1h" ? "cada hora" : v === "6h" ? "cada 6 horas" : v === "24h" ? "una vez al día" : "";
      return cada ? { hace: [`Revisas que el sitio siga en pie ${cada}.`], noHace: [] } : null;
    },
    avisar_a: (v) => {
      const correo = enUnaLinea(v);
      return correo ? { hace: [`Si el sitio se cae, avisas a ${correo}.`], noHace: [] } : null;
    },
    // `sitio` no genera frase: la dirección sale de la conexión de WordPress, y
    // repetirla en el prompt solo crea una segunda verdad que puede quedar vieja.
  },
};

/** Las instrucciones que se añaden a la ficha inicial de un agente contratado. */
export function instruccionesDeAjustes(
  slug: string,
  ajustes: Readonly<Record<string, string>>,
): InstruccionesDeAjustes {
  const porCampo = TRADUCTORES[slug];
  if (!porCampo) return VACIO;

  const hace: string[] = [];
  const noHace: string[] = [];
  // Se recorre el traductor y no las respuestas, para que el orden de las
  // frases sea siempre el mismo: dos agentes iguales tienen el mismo prompt.
  for (const [clave, traducir] of Object.entries(porCampo)) {
    const valor = ajustes[clave];
    if (typeof valor !== "string") continue;
    const frases = traducir(valor);
    if (!frases) continue;
    hace.push(...frases.hace);
    noHace.push(...frases.noHace);
  }
  return { hace, noHace };
}
