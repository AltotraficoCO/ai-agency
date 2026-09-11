import "server-only";

/**
 * Las herramientas de Strap.
 *
 * Se definen con `defineTool` de `@strappy/tools`, igual que las que usan los
 * agentes que Strap construye. No es simetría estética: ese registro rechaza al
 * arrancar cualquier esquema que exponga `workspaceId` al modelo, valida la
 * entrada antes de ejecutar y filtra secretos de lo que se registra. Nada de
 * eso hay que volver a escribirlo aquí.
 *
 * Dos reglas gobiernan el archivo:
 *
 *  1. TODA la interfaz enriquecida sale del valor que devuelve una herramienta.
 *     Nunca del texto. Por eso cada `execute` devuelve un objeto de `tipos.ts`.
 *
 *  2. Las reglas duras del guion viven en el ESQUEMA, no en el prompt. Que
 *     `preguntar` acepte como mucho tres preguntas y cuatro opciones no es una
 *     recomendación que el modelo pueda ignorar un martes: es un `.max(3)` que
 *     rechaza la llamada.
 */
import { z } from "zod";
import {
  borradorAEspecificacion,
  capacidadDelBorrador,
  compilePrompt,
  esFaseMeta,
  esSitioWeb,
  esquemaBorradorAgente,
  huecosDeLaFase,
  normalizarClave,
  normalizarParcial,
  rutasConocidas,
  type BorradorAgente,
  type FaseMeta,
  type ModelTable,
} from "@strappy/core";
import { defineTool, type ToolDef } from "@strappy/tools";
import { componerInstrucciones, leerEspecificacion } from "@strappy/db/spec";
import { actualizarHilo, leerHilo, type ContextoEmpresa } from "./borradores";
import { analizarSitio, resumirSitio } from "./sitio";
import { crearCerebroConFuentes } from "./cerebro";
import { publicarAgenteDeStrap } from "./publicar";
import { jugarSolo } from "./autojuego";
import type {
  SalidaAutojuego,
  SalidaBorrador,
  SalidaChecklist,
  SalidaContexto,
  SalidaPreguntar,
  SalidaProgreso,
  SalidaTarjeta,
  SalidaTexto,
} from "./tipos";

/** Permisos de una sesión de construcción. Deny by default, como todo lo demás. */
export const PERMISOS_STRAP = [
  "meta.read",
  "meta.write",
  "agents.write",
  "knowledge.write",
] as const;

export type EntornoStrap = {
  readonly workspaceId: string;
  readonly usuarioId: string;
  readonly hiloId: string;
  readonly modo: "lite" | "max";
  readonly modelTable: ModelTable;
  readonly empresa: ContextoEmpresa;
};

const SIN_ENTRADA = z.object({});

// ---------------------------------------------------------------------------
// Utilidades compartidas
// ---------------------------------------------------------------------------

async function cargar(entorno: EntornoStrap): Promise<{
  fase: FaseMeta;
  borrador: BorradorAgente;
  agenteId: string | null;
  titulo: string;
}> {
  const hilo = await leerHilo(entorno.workspaceId, entorno.hiloId);
  if (!hilo) throw new Error("Este hilo ya no existe.");
  return {
    fase: hilo.fase,
    borrador: esquemaBorradorAgente.parse(hilo.borrador),
    agenteId: hilo.agenteId,
    titulo: hilo.titulo,
  };
}

function pendientesDe(entorno: EntornoStrap, fase: FaseMeta, borrador: BorradorAgente): string[] {
  return [
    ...huecosDeLaFase({
      capacidad: capacidadDelBorrador(undefined),
      fase,
      borrador,
      yaSabido: entorno.empresa.rutasConocidas,
    }),
  ];
}

/**
 * Traduce la clave que escribió el modelo a una ruta real del borrador.
 *
 * Es la red de seguridad de la regla más importante del producto: si una
 * respuesta se guarda en `agente_nombre` en vez de en `agente.nombre`, la
 * pregunta vuelve a salir y toda la sensación de «ya me conoce» se cae. Se
 * corrige lo evidente y se RECHAZA lo dudoso, con un mensaje que el modelo
 * pueda arreglar en el mismo turno en vez de un fallo silencioso.
 */
function exigirClave(clave: string): string {
  const capacidad = capacidadDelBorrador(undefined);
  const normalizada = normalizarClave(clave, capacidad);
  if (normalizada) return normalizada;
  throw new Error(
    `La clave "${clave}" no existe en el borrador. Usa una de estas, con punto y tal cual: ` +
      `${rutasConocidas(capacidad).join(", ")}.`,
  );
}

function preguntaDelGuion(clave: string) {
  return capacidadDelBorrador(undefined)
    .phases.flatMap((fase) => fase.questions)
    .find((pregunta) => pregunta.key === clave);
}

const ETIQUETAS_CHECKLIST: readonly { clave: string; etiqueta: string; editable: boolean }[] = [
  { clave: "agente.nombre", etiqueta: "Se llama", editable: true },
  { clave: "agente.proposito", etiqueta: "Existe para", editable: true },
  { clave: "agente.tono", etiqueta: "Habla así", editable: true },
  { clave: "empresa.nombre", etiqueta: "Trabaja para", editable: true },
  { clave: "empresa.horario", etiqueta: "Horario", editable: true },
  { clave: "canal", etiqueta: "Atiende por", editable: true },
  { clave: "objetivo", etiqueta: "Su objetivo", editable: true },
];

function valorLegible(borrador: BorradorAgente, clave: string): string {
  const partes = clave.split(".");
  let actual: unknown = borrador;
  for (const parte of partes) {
    if (actual === null || typeof actual !== "object") return "";
    actual = (actual as Record<string, unknown>)[parte];
  }
  if (Array.isArray(actual)) return actual.map((v) => String(v)).join(", ");
  return actual === undefined || actual === null ? "" : String(actual);
}

// ---------------------------------------------------------------------------
// Las doce herramientas
// ---------------------------------------------------------------------------

export function crearHerramientasDeStrap(entorno: EntornoStrap): ToolDef<never, unknown>[] {
  const herramientas: ToolDef<never, unknown>[] = [];
  const anadir = <I, O>(def: ToolDef<I, O>): void => {
    herramientas.push(defineTool(def) as unknown as ToolDef<never, unknown>);
  };

  // 1 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "leer_contexto_empresa",
    label: "Leer la ficha de la empresa",
    description:
      "Devuelve lo que el espacio de trabajo ya sabe de la empresa y qué preguntas quedan por tanto contestadas de antemano.",
    whenToUse: "SIEMPRE al empezar, antes de preguntar nada",
    inputSchema: SIN_ENTRADA,
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.read"],
    effect: "read",
    async execute(): Promise<SalidaContexto> {
      return {
        tipo: "contexto",
        empresa: entorno.empresa.datos,
        conocido: entorno.empresa.rutasConocidas,
      };
    },
  });

  // 2 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "analizar_sitio_web",
    label: "Leer el sitio web",
    description:
      "Descarga el sitio web de la empresa —por sitemap si lo publica— y lo convierte a texto limpio para saber a qué se dedica.",
    whenToUse: "cuando la persona te dé una dirección web",
    inputSchema: z.object({
      url: z.string().min(4).describe("La dirección del sitio, con o sin https://"),
      maximoPaginas: z.number().int().min(1).max(30).optional(),
    }),
    sensitive: false,
    creditCost: 1,
    scopes: ["meta.read"],
    effect: "read",
    async execute(_ctx, entrada): Promise<SalidaProgreso> {
      try {
        const resultado = await analizarSitio(entrada.url, {
          ...(entrada.maximoPaginas ? { maximoPaginas: entrada.maximoPaginas } : {}),
        });
        const cuantas = resultado.paginas.length;

        if (cuantas > 0) {
          await actualizarHilo(entorno.workspaceId, entorno.hiloId, {
            borrador: {
              empresa: { sitioWeb: resultado.url },
              fuentes: [{ url: resultado.url, paginas: cuantas }],
            },
          });
        }

        return {
          tipo: "progreso",
          titulo: "Leyendo tu sitio web",
          pasos: [
            {
              etiqueta:
                resultado.metodo === "sitemap"
                  ? "Encontré el mapa del sitio"
                  : "No hay mapa del sitio, recorrí los enlaces",
              estado: "hecho",
            },
            {
              etiqueta: `Leí ${cuantas} ${cuantas === 1 ? "página" : "páginas"}`,
              estado: cuantas > 0 ? "hecho" : "fallido",
              detalle: cuantas > 0 ? resumirSitio(resultado) : "No había texto aprovechable.",
            },
            ...(resultado.descartadas.length > 0
              ? [
                  {
                    etiqueta: `Descarté ${resultado.descartadas.length}`,
                    estado: "omitido" as const,
                    detalle: resultado.descartadas
                      .slice(0, 3)
                      .map((d) => d.motivo)
                      .join(", "),
                  },
                ]
              : []),
          ],
          resumen:
            cuantas > 0
              ? `Leí ${cuantas} ${cuantas === 1 ? "página" : "páginas"} de ${resultado.url}.`
              : `No pude sacar texto de ${resultado.url}.`,
        };
      } catch (error) {
        return {
          tipo: "progreso",
          titulo: "Leyendo tu sitio web",
          pasos: [
            {
              etiqueta: "No pude entrar al sitio",
              estado: "fallido",
              detalle: error instanceof Error ? error.message : "dirección no válida",
            },
          ],
          resumen: "No pude leer ese sitio. Cuéntame tú a qué se dedica el negocio.",
        };
      }
    },
  });

  // 3 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "preguntar",
    label: "Preguntar",
    description:
      "Le hace a la persona hasta tres preguntas con opciones para elegir; las contesta todas de una vez. Después de llamarla, el turno TERMINA: no escribas nada más.",
    whenToUse: "cada vez que necesites un dato que no está en el borrador ni en la ficha de la empresa",
    inputSchema: z.object({
      preguntas: z
        .array(
          z.object({
            clave: z
              .string()
              .min(1)
              .describe("Ruta del dato en el borrador, por ejemplo empresa.nombre"),
            enunciado: z.string().min(3),
            opciones: z
              .array(
                z.object({
                  valor: z.string(),
                  etiqueta: z.string().min(1),
                  pista: z.string().optional(),
                }),
              )
              .default([])
              // Se piden como mucho cuatro, pero se aceptan de más y se enseñan las
              // cuatro primeras: rechazarlas hacía que el modelo le pidiera perdón a
              // la persona por «pasarse con las opciones».
              .describe("Como mucho 4 opciones; si mandas más, solo se enseñan las 4 primeras"),
            multiple: z
              .boolean()
              .optional()
              .describe("true si se puede elegir más de una opción"),
            abierta: z
              .boolean()
              .optional()
              .describe("true solo si la respuesta no se puede acotar a opciones"),
          }),
        )
        .min(1)
        .describe("Como mucho 3 preguntas por ronda; si mandas más, solo se hacen las 3 primeras"),
    }),
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.read"],
    effect: "read",
    async execute(_ctx, entrada): Promise<SalidaPreguntar> {
      const { fase } = await cargar(entorno);
      return {
        tipo: "preguntas",
        fase,
        preguntas: entrada.preguntas.slice(0, 3).map((p) => {
          const clave = exigirClave(p.clave);
          // Si la pregunta es del guion, manda el guion: que admita varias
          // respuestas o texto libre no puede depender de que el modelo se
          // acuerde de pasar la bandera.
          const guion = preguntaDelGuion(clave);
          const opciones =
            p.opciones.length > 0
              ? p.opciones.slice(0, 4).map((o) => ({
                  valor: o.valor,
                  etiqueta: o.etiqueta,
                  ...(o.pista ? { pista: o.pista } : {}),
                }))
              : (guion?.options ?? []).map((o) => ({
                  valor: o.value,
                  etiqueta: o.label,
                  ...(o.hint ? { pista: o.hint } : {}),
                }));
          return {
            clave,
            enunciado: p.enunciado,
            opciones,
            multiple: guion?.multiple === true || p.multiple === true,
            abierta: guion?.allowFreeText === true || p.abierta === true || opciones.length === 0,
          };
        }),
      };
    },
  });

  // 4 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "draft_leer",
    label: "Leer el borrador",
    description:
      "Devuelve el borrador del agente tal como está guardado, la fase del guion y qué falta por saber.",
    whenToUse: "antes de preguntar, para no repetir algo que ya sabes",
    inputSchema: SIN_ENTRADA,
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.read"],
    effect: "read",
    async execute(): Promise<SalidaBorrador> {
      const { fase, borrador } = await cargar(entorno);
      return { tipo: "borrador", fase, borrador, pendientes: pendientesDe(entorno, fase, borrador) };
    },
  });

  // 5 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "draft_actualizar",
    label: "Guardar en el borrador",
    description:
      "Funde un cambio PARCIAL sobre el borrador y lo valida. Lo que no mandes se conserva; las listas se reemplazan enteras.",
    whenToUse: "en cuanto la persona te diga algo nuevo, antes de seguir preguntando",
    inputSchema: z.object({
      parcial: z
        .record(z.string(), z.unknown())
        .describe(
          "Solo las ramas que cambian, ANIDADAS igual que el borrador: " +
            '{"agente":{"nombre":"Espiga"}}, nunca {"agente_nombre":"Espiga"}',
        ),
      fase: z
        .enum([
          "intencion",
          "recoleccion_1",
          "recoleccion_2",
          "confirmacion",
          "construccion",
          "reporte",
          "prueba",
          "entrega",
        ])
        .optional()
        .describe("Solo si la fase actual ya no tiene nada pendiente"),
      titulo: z.string().max(80).optional().describe("Cómo se llama esta conversación en la lista"),
    }),
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.write"],
    effect: "write_internal",
    async execute(_ctx, entrada): Promise<SalidaBorrador> {
      // Los modelos meten `fase` y `titulo` DENTRO del parcial la mitad de las
      // veces. Es una confusión razonable —los tres son argumentos de la misma
      // llamada— y rechazarla cuesta un turno; sacarlos de ahí, tres líneas.
      const { fase: faseIncrustada, titulo: tituloIncrustado, ...resto } = entrada.parcial;
      const fase = entrada.fase ?? (typeof faseIncrustada === "string" ? faseIncrustada : undefined);
      const titulo =
        entrada.titulo ?? (typeof tituloIncrustado === "string" ? tituloIncrustado : undefined);

      const hilo = await actualizarHilo(entorno.workspaceId, entorno.hiloId, {
        borrador: normalizarParcial(resto, capacidadDelBorrador(undefined)),
        ...(esFaseMeta(fase) ? { fase } : {}),
        ...(titulo ? { titulo } : {}),
      });
      const borrador = esquemaBorradorAgente.parse(hilo.borrador);
      return {
        tipo: "borrador",
        fase: hilo.fase,
        borrador,
        pendientes: pendientesDe(entorno, hilo.fase, borrador),
      };
    },
  });

  // 6 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "generar_prompt_agente",
    label: "Compilar el prompt",
    description:
      "Compone las instrucciones del agente a partir del borrador y devuelve su huella. Es determinista: el mismo borrador da siempre el mismo texto.",
    whenToUse: "cuando el borrador ya tenga identidad y al menos una cosa que hacer",
    inputSchema: SIN_ENTRADA,
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.read"],
    effect: "read",
    async execute(): Promise<SalidaTexto> {
      const { borrador } = await cargar(entorno);
      const spec = leerEspecificacion(borradorAEspecificacion(borrador));
      const texto = componerInstrucciones(spec);
      const compilado = compilePrompt({
        agent: {
          name: spec.identidad.nombre,
          language: spec.identidad.idioma,
          tone: spec.identidad.tono,
          purpose: spec.identidad.proposito,
        },
        instructions: texto,
      });
      return {
        tipo: "texto",
        titulo: `Instrucciones de ${spec.identidad.nombre}`,
        cuerpo: `${texto}\n\nHuella del prompt: ${compilado.hash.slice(0, 12)}`,
      };
    },
  });

  // 7 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "proponer_variables_extraccion",
    label: "Proponer qué datos recoger",
    description:
      "Guarda qué datos debe sacarle el agente a SUS CLIENTES durante la conversación (nombre, teléfono, qué le interesa). No son preguntas para la persona que está construyendo.",
    whenToUse: "cuando ya sepas para qué es el agente",
    inputSchema: z.object({
      variables: z
        .array(
          z.object({
            clave: z
              .string()
              .regex(/^[a-z][a-z0-9_]*$/, "minúsculas, dígitos y guion bajo")
              .describe("Identificador, por ejemplo telefono"),
            etiqueta: z.string().min(1).describe("Cómo se llama para una persona"),
            pista: z.string().optional(),
            obligatorio: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(8),
    }),
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.write"],
    effect: "write_internal",
    async execute(_ctx, entrada): Promise<SalidaChecklist> {
      await actualizarHilo(entorno.workspaceId, entorno.hiloId, {
        borrador: { recoger: entrada.variables },
      });
      return {
        tipo: "checklist",
        titulo: "Datos que va a averiguar",
        items: entrada.variables.map((v) => ({
          clave: `recoger.${v.clave}`,
          etiqueta: v.etiqueta,
          valor: v.obligatorio ? "siempre" : "si surge",
          editable: false,
        })),
        aviso: "Los pregunta cuando vengan a cuento, nunca como formulario.",
      };
    },
  });

  // 8 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "crear_brain_desde_fuentes",
    label: "Crear el Cerebro",
    description:
      "Crea la base de conocimiento del agente e indexa en ella las páginas del sitio y los textos que le des.",
    whenToUse: "cuando haya un sitio web leído o textos que el agente deba conocer",
    inputSchema: z.object({
      nombre: z.string().min(1).max(60),
      urls: z.array(z.string()).max(5).default([]),
      textos: z
        .array(z.object({ titulo: z.string().min(1), contenido: z.string().min(20) }))
        .max(10)
        .default([]),
    }),
    sensitive: false,
    creditCost: 2,
    scopes: ["knowledge.write"],
    effect: "write_internal",
    async execute(_ctx, entrada): Promise<SalidaProgreso> {
      const resultado = await crearCerebroConFuentes({
        workspaceId: entorno.workspaceId,
        usuarioId: entorno.usuarioId,
        nombre: entrada.nombre,
        urls: entrada.urls,
        textos: entrada.textos,
      });
      if (resultado.cerebroId) {
        await actualizarHilo(entorno.workspaceId, entorno.hiloId, {
          borrador: { cerebroId: resultado.cerebroId },
        });
      }
      return resultado.progreso;
    },
  });

  // 9 ────────────────────────────────────────────────────────────────────────
  anadir({
    slug: "confirmar_construccion",
    label: "Confirmar antes de construir",
    description:
      "Enseña la ficha completa del agente para revisarla y corregirla antes de crear nada en la base de datos.",
    whenToUse: "una sola vez, justo antes de publicar",
    inputSchema: SIN_ENTRADA,
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.read"],
    effect: "read",
    async execute(): Promise<SalidaChecklist> {
      const { borrador } = await cargar(entorno);
      const items = ETIQUETAS_CHECKLIST.map((e) => ({
        clave: e.clave,
        etiqueta: e.etiqueta,
        valor: valorLegible(borrador, e.clave),
        editable: e.editable,
      })).filter((i) => i.valor.length > 0);

      if (borrador.hace.length > 0) {
        items.push({
          clave: "hace",
          etiqueta: "Qué hace",
          valor: borrador.hace.join(" · "),
          editable: false,
        });
      }
      if (borrador.recoger.length > 0) {
        items.push({
          clave: "recoger",
          etiqueta: "Qué averigua",
          valor: borrador.recoger.map((c) => c.etiqueta).join(", "),
          editable: false,
        });
      }
      if (borrador.cerebroId) {
        items.push({
          clave: "cerebroId",
          etiqueta: "Conocimiento",
          valor: "Cerebro conectado",
          editable: false,
        });
      }

      // Publicar sin esto falla, y falla DESPUÉS de que la persona haya dicho
      // que sí: mejor avisarlo mientras todavía se está revisando.
      const falta = borrador.hace.length === 0
        ? "Falta decir qué hace el agente antes de poder publicarlo."
        : "Puedes corregir cualquier línea aquí mismo; no perdemos el hilo.";

      return { tipo: "checklist", titulo: "Esto es lo que voy a construir", items, aviso: falta };
    },
  });

  // 10 ───────────────────────────────────────────────────────────────────────
  anadir({
    slug: "publicar_agente",
    label: "Publicar el agente",
    description:
      "Crea el agente, su versión inmutable y sus variables, todo en una transacción, y lo deja atendiendo.",
    whenToUse: "solo después de que la persona confirme la ficha",
    inputSchema: SIN_ENTRADA,
    sensitive: false,
    creditCost: 5,
    scopes: ["agents.write"],
    effect: "write_internal",
    async execute(): Promise<SalidaTarjeta> {
      const { borrador, agenteId } = await cargar(entorno);
      const spec = borradorAEspecificacion(borrador);
      const empresa = borrador.empresa?.nombre
        ? {
            name: borrador.empresa.nombre,
            ...(borrador.empresa.descripcion ? { description: borrador.empresa.descripcion } : {}),
            ...(borrador.empresa.sector ? { industry: borrador.empresa.sector } : {}),
            ...(esSitioWeb(borrador.empresa.sitioWeb) ? { website: borrador.empresa.sitioWeb } : {}),
            ...(borrador.empresa.horario ? { hours: borrador.empresa.horario } : {}),
          }
        : undefined;

      const resultado = await publicarAgenteDeStrap(entorno.workspaceId, {
        spec: leerEspecificacion(spec),
        modo: entorno.modo,
        descripcion: spec.identidad.proposito,
        usuarioId: entorno.usuarioId,
        ...(agenteId ? { agenteId } : {}),
        ...(empresa ? { empresa } : {}),
        ...(borrador.cerebroId ? { cerebroId: borrador.cerebroId } : {}),
        variables: borrador.recoger.map((c) => ({
          clave: c.clave,
          etiqueta: c.etiqueta,
          tipo: "text" as const,
          obligatoria: c.obligatorio === true,
          ...(c.pista ? { descripcion: c.pista } : {}),
        })),
      });

      await actualizarHilo(entorno.workspaceId, entorno.hiloId, {
        agenteId: resultado.agenteId,
        titulo: resultado.nombre,
        fase: "reporte",
        borrador: {
          agenteId: resultado.agenteId,
          versionId: resultado.versionId,
          huellaPrompt: resultado.huellaPrompt,
        },
      });

      return tarjetaDe(borrador, resultado.agenteId, resultado.nombre, resultado.version);
    },
  });

  // 11 ───────────────────────────────────────────────────────────────────────
  anadir({
    slug: "probar_agente",
    label: "Probarlo solo",
    description:
      "Pone a un modelo a hacer de cliente y lo enfrenta al agente publicado durante varios turnos. Devuelve la conversación y los datos que el agente consiguió averiguar.",
    whenToUse: "justo después de publicar, sin que la persona tenga que escribir nada",
    inputSchema: z.object({
      guion: z
        .string()
        .min(5)
        .max(160)
        .describe("Qué clase de cliente simular, p. ej. «interesado con presupuesto bajo»"),
      turnos: z.number().int().min(4).max(6).optional(),
    }),
    sensitive: false,
    creditCost: 3,
    scopes: ["agents.write"],
    effect: "write_internal",
    async execute(_ctx, entrada): Promise<SalidaAutojuego> {
      // Los modelos llaman a esta herramienta EN PARALELO con `publicar_agente`
      // más veces de las que deberían, y entonces llega antes de que el agente
      // exista. Se espera un poco releyendo el hilo en vez de contestar «no hay
      // nada que probar» a alguien que acaba de publicar.
      const { borrador, agenteId } = await esperarAlAgente(entorno);
      const id = agenteId ?? borrador.agenteId;
      if (!id) {
        return {
          tipo: "autojuego",
          guion: entrada.guion,
          turnos: [],
          variables: [],
          aviso: "Todavía no hay ningún agente publicado. Publícalo y vuelve a probarlo.",
        };
      }
      return jugarSolo({
        workspaceId: entorno.workspaceId,
        agentId: id,
        guion: entrada.guion,
        modo: entorno.modo,
        modelTable: entorno.modelTable,
        nombreAgente: borrador.agente?.nombre ?? "Agente",
        recoger: borrador.recoger.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta })),
        ...(entrada.turnos ? { turnos: entrada.turnos } : {}),
      });
    },
  });

  // 12 ───────────────────────────────────────────────────────────────────────
  anadir({
    slug: "mostrar_tarjeta_agente",
    label: "Enseñar la tarjeta del agente",
    description: "Muestra la tarjeta del agente ya publicado, con el enlace para abrirlo.",
    whenToUse: "al cerrar la conversación, como último mensaje",
    inputSchema: SIN_ENTRADA,
    sensitive: false,
    creditCost: 0,
    scopes: ["meta.read"],
    effect: "read",
    async execute(): Promise<SalidaTarjeta> {
      const { borrador, agenteId } = await cargar(entorno);
      const id = agenteId ?? borrador.agenteId;
      if (!id) throw new Error("Todavía no hay ningún agente publicado en este hilo.");
      await actualizarHilo(entorno.workspaceId, entorno.hiloId, { fase: "entrega" });
      return tarjetaDe(borrador, id, borrador.agente?.nombre ?? "Tu agente");
    },
  });

  return herramientas;
}

/** Hasta tres segundos esperando a que la publicación en curso deje su rastro. */
async function esperarAlAgente(
  entorno: EntornoStrap,
): Promise<Awaited<ReturnType<typeof cargar>>> {
  let estado = await cargar(entorno);
  for (let intento = 0; intento < 6; intento++) {
    if (estado.agenteId ?? estado.borrador.agenteId) return estado;
    await new Promise((listo) => setTimeout(listo, 500));
    estado = await cargar(entorno);
  }
  return estado;
}

function tarjetaDe(
  borrador: BorradorAgente,
  agenteId: string,
  nombre: string,
  version?: number,
): SalidaTarjeta {
  const detalles: { etiqueta: string; valor: string }[] = [];
  if (borrador.canal) detalles.push({ etiqueta: "Canal", valor: etiquetaCanal(borrador.canal) });
  if (borrador.recoger.length > 0) {
    detalles.push({
      etiqueta: "Averigua",
      valor: borrador.recoger.map((c) => c.etiqueta).join(", "),
    });
  }
  if (borrador.cerebroId) detalles.push({ etiqueta: "Conocimiento", valor: "Cerebro conectado" });

  return {
    tipo: "tarjeta",
    entidad: "agente",
    id: agenteId,
    nombre,
    descripcion: borrador.agente?.proposito ?? "Atiende a quien escribe.",
    detalles,
    enlace: `/agentes/${agenteId}`,
    textoEnlace: "Abrir el agente",
    ...(version ? { version } : {}),
  };
}

const CANALES: Readonly<Record<string, string>> = {
  whatsapp: "WhatsApp",
  webchat: "Chat de la web",
  simulador: "Simulador",
};

function etiquetaCanal(slug: string): string {
  return CANALES[slug] ?? slug;
}
