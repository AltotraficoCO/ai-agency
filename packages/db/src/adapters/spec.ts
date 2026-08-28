/**
 * La forma del `spec` de un agente conversacional y su traducción a `PromptSpec`.
 *
 * Se guarda en `agents` a través de `agent_versions.spec` (jsonb). Las claves
 * están en español porque es lo que el constructor de agentes edita y lo que un
 * humano lee al depurar una versión publicada.
 *
 * El prompt en Markdown NO es un campo más: es la proyección de estos campos.
 * `componerInstrucciones()` es la función que hace visible esa relación —el
 * formulario de la izquierda escribe el texto de la derecha— y por eso vive
 * aquí, junto al spec, y no en la interfaz.
 */
import type { PromptSpec } from '@strappy/core';

export type CampoARecoger = {
  clave: string;
  etiqueta: string;
  pista?: string;
  obligatorio?: boolean;
};

export type EspecificacionAgente = {
  identidad: {
    nombre: string;
    idioma: string;
    tono: string;
    proposito: string;
  };
  objetivo?: string;
  /** Qué hace: una lista de tareas concretas. */
  hace: string[];
  /** Qué NO debe hacer: los límites, en las palabras de la empresa. */
  noHace: string[];
  recoger: CampoARecoger[];
  /** Señales que obligan a pasar la conversación a una persona. */
  escalar: string[];
  variables?: Record<string, string>;
  /**
   * Prompt editado a mano. Cuando existe, gana sobre el texto compuesto: el
   * editor es de verdad, no una vista previa.
   */
  instruccionesManuales?: string;
};

export const ESPECIFICACION_VACIA: EspecificacionAgente = {
  identidad: { nombre: '', idioma: 'español', tono: '', proposito: '' },
  hace: [],
  noHace: [],
  recoger: [],
  escalar: [],
};

/** Títulos de sección. Son el ancla que enlaza cada campo con su parte del prompt. */
export const SECCIONES = {
  identidad: 'Identidad',
  hace: 'Qué hace',
  noHace: 'Qué no debe hacer',
  recoger: 'Datos a recoger',
  escalar: 'Cuándo pasar a un humano',
} as const;

export type ClaveSeccion = keyof typeof SECCIONES;

export function encabezado(clave: ClaveSeccion): string {
  return `## ${SECCIONES[clave]}`;
}

/** Compone el Markdown a partir de los campos. Determinista: mismo spec, mismo texto. */
export function componerInstrucciones(spec: EspecificacionAgente): string {
  const bloques: string[] = [];

  bloques.push(
    [
      encabezado('identidad'),
      `Te llamas ${spec.identidad.nombre || 'el asistente'}.`,
      spec.identidad.proposito ? `Existes para ${spec.identidad.proposito}` : '',
      spec.identidad.tono ? `Hablas así: ${spec.identidad.tono}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  bloques.push(
    [encabezado('hace'), ...listar(spec.hace, 'Todavía no se ha definido qué hace.')].join('\n'),
  );

  bloques.push(
    [encabezado('noHace'), ...listar(spec.noHace, 'Sin límites declarados.')].join('\n'),
  );

  bloques.push(
    [
      encabezado('recoger'),
      ...(spec.recoger.length === 0
        ? ['No hay datos que averiguar.']
        : spec.recoger.map(
            (c) =>
              `- **${c.etiqueta}** (\`${c.clave}\`)${c.obligatorio ? ' · obligatorio' : ''}${
                c.pista ? ` — ${c.pista}` : ''
              }`,
          )),
      'Pregúntalos de uno en uno y solo cuando venga a cuento. Esto es una conversación, no un formulario.',
    ].join('\n'),
  );

  bloques.push(
    [
      encabezado('escalar'),
      ...listar(spec.escalar, 'Cuando la persona lo pida expresamente.'),
      'Al pasar la conversación, dilo con naturalidad y deja de responder.',
    ].join('\n'),
  );

  return bloques.join('\n\n');
}

function listar(valores: readonly string[], vacio: string): string[] {
  if (valores.length === 0) return [vacio];
  return valores.map((v) => `- ${v}`);
}

/** El texto que se envía al modelo: el manual si lo hay, el compuesto si no. */
export function instruccionesEfectivas(spec: EspecificacionAgente): string {
  const manual = spec.instruccionesManuales?.trim();
  return manual && manual.length > 0 ? manual : componerInstrucciones(spec);
}

/** Normaliza un jsonb cualquiera a un spec completo, sin lanzar. */
export function leerEspecificacion(valor: unknown): EspecificacionAgente {
  const v = (valor ?? {}) as Record<string, unknown>;
  const identidad = (v['identidad'] ?? {}) as Record<string, unknown>;
  return {
    identidad: {
      nombre: texto(identidad['nombre']),
      idioma: texto(identidad['idioma']) || 'español',
      tono: texto(identidad['tono']),
      proposito: texto(identidad['proposito']),
    },
    ...(texto(v['objetivo']) ? { objetivo: texto(v['objetivo']) } : {}),
    hace: listaDeTextos(v['hace']),
    noHace: listaDeTextos(v['noHace'] ?? v['no_hace']),
    recoger: Array.isArray(v['recoger'])
      ? (v['recoger'] as Record<string, unknown>[])
          .map((c) => ({
            clave: texto(c['clave']),
            etiqueta: texto(c['etiqueta']),
            ...(texto(c['pista']) ? { pista: texto(c['pista']) } : {}),
            ...(c['obligatorio'] ? { obligatorio: true } : {}),
          }))
          .filter((c) => c.clave.length > 0)
      : [],
    escalar: listaDeTextos(v['escalar']),
    ...(v['variables'] && typeof v['variables'] === 'object'
      ? { variables: v['variables'] as Record<string, string> }
      : {}),
    ...(texto(v['instruccionesManuales'] ?? v['instrucciones_manuales'])
      ? { instruccionesManuales: texto(v['instruccionesManuales'] ?? v['instrucciones_manuales']) }
      : {}),
  };
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function listaDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export type DatosEmpresa = {
  name: string;
  description?: string;
  industry?: string;
  website?: string;
  hours?: string;
  policies?: readonly string[];
};

/** Del spec guardado al `PromptSpec` que compila el motor. */
export function aPromptSpec(
  spec: EspecificacionAgente,
  extra: { empresa?: DatosEmpresa; etiquetaCanal?: string } = {},
): PromptSpec {
  return {
    agent: {
      name: spec.identidad.nombre || 'Asistente',
      language: spec.identidad.idioma || 'español',
      tone: spec.identidad.tono || 'cercano y claro',
      purpose: spec.identidad.proposito || 'atender a quien escribe',
    },
    ...(extra.empresa ? { company: extra.empresa } : {}),
    instructions: instruccionesEfectivas(spec),
    ...(spec.variables ? { variables: spec.variables } : {}),
    ...(spec.objetivo ? { goal: spec.objetivo } : {}),
    ...(spec.recoger.length > 0
      ? {
          collect: spec.recoger.map((c) => ({
            key: c.clave,
            label: c.etiqueta,
            ...(c.pista ? { hint: c.pista } : {}),
            ...(c.obligatorio ? { required: true } : {}),
          })),
        }
      : {}),
    ...(extra.etiquetaCanal ? { channelLabel: extra.etiquetaCanal } : {}),
  };
}
