/**
 * De la plantilla del catálogo a la ficha que edita el cliente.
 *
 * El fallo que esto previene (sep-2026): contratabas un agente, abrías
 * Instrucciones y la Identidad estaba en blanco —sin nombre, sin para qué
 * existe, sin cómo habla— aunque el agente ya tuviera nombre y su plantilla
 * tuviera todo eso escrito. Nadie traducía las claves en inglés del catálogo
 * (`persona`, `goals`, `guardrails`) a las que lee el constructor.
 *
 * Puro: no toca Postgres.
 */
import { describe, expect, it } from 'vitest';
import {
  ESPECIFICACION_VACIA,
  conRespaldoDelCatalogo,
  desdePlantillaDeCatalogo,
  fichaVacia,
  leerEspecificacion,
} from '../src/adapters/spec.js';

/** La plantilla real del Velocista (migración 0035), recortada. */
const VELOCISTA = {
  persona: { tone: 'cercano', language: 'es-CO' },
  goals: ['medir la velocidad real de las paginas que importan', 'explicar sin jerga que esta frenando la web'],
  guardrails: ['nunca opinar de velocidad sin haber medido en esta misma tarea', 'no prometer mejoras que no se midieron'],
};

/** La del Recepcionista (migración 0010): es la única que declara `handover`. */
const RECEPCIONISTA = {
  persona: { tone: 'cercano', language: 'es-CO' },
  goals: ['resolver dudas frecuentes'],
  guardrails: ['no inventar precios'],
  handover: { on_request: true, on_complaint: true },
};

describe('la ficha inicial de un agente del catálogo', () => {
  it('trae nombre, para qué existe y cómo habla', () => {
    const spec = desdePlantillaDeCatalogo({
      nombre: 'Larry',
      descripcion: 'Mide cuánto tarda tu web en abrir y arregla lo que se puede.',
      gancho: 'Hace que tu página cargue rápido',
      plantilla: VELOCISTA,
    });

    expect(spec.identidad.nombre).toBe('Larry');
    expect(spec.identidad.proposito).toBe('Mide cuánto tarda tu web en abrir y arregla lo que se puede.');
    expect(spec.identidad.tono).toBe('cercano');
    expect(spec.hace).toHaveLength(2);
    expect(spec.noHace).toHaveLength(2);
  });

  it('dice el idioma como lo diría una persona, no como un código', () => {
    // `es-CO` es lo que entiende el motor; el cliente lee «español».
    expect(desdePlantillaDeCatalogo({ nombre: 'A', plantilla: VELOCISTA }).identidad.idioma).toBe('español');
    expect(
      desdePlantillaDeCatalogo({ nombre: 'A', plantilla: { persona: { language: 'en-US' } } }).identidad.idioma,
    ).toBe('inglés');
    expect(desdePlantillaDeCatalogo({ nombre: 'A', plantilla: {} }).identidad.idioma).toBe('español');
  });

  it('usa el gancho cuando no hay descripción, en vez de dejarlo vacío', () => {
    const spec = desdePlantillaDeCatalogo({
      nombre: 'Larry',
      descripcion: '',
      gancho: 'Hace que tu página cargue rápido',
      plantilla: VELOCISTA,
    });
    expect(spec.identidad.proposito).toBe('Hace que tu página cargue rápido');
  });

  it('solo escala por lo que la plantilla declara', () => {
    const conHandover = desdePlantillaDeCatalogo({ nombre: 'Ana', plantilla: RECEPCIONISTA });
    expect(conHandover.escalar).toHaveLength(2);

    // El Velocista no declara `handover`: no se le inventa ninguna señal.
    const sinHandover = desdePlantillaDeCatalogo({ nombre: 'Larry', plantilla: VELOCISTA });
    expect(sinHandover.escalar).toEqual([]);
  });

  it('aguanta una plantilla vacía o rota sin lanzar', () => {
    expect(desdePlantillaDeCatalogo({ nombre: 'A', plantilla: null }).identidad.nombre).toBe('A');
    expect(desdePlantillaDeCatalogo({ nombre: 'A', plantilla: 'no soy un objeto' }).hace).toEqual([]);
    expect(desdePlantillaDeCatalogo({ nombre: 'A', plantilla: { goals: [1, 2] } }).hace).toEqual([]);
  });
});

describe('rellenar lo vacío sin pisar lo escrito', () => {
  const respaldo = { nombre: 'Larry', descripcion: 'Mide tu web.', plantilla: VELOCISTA };

  it('una ficha en blanco se rellena con la del catálogo', () => {
    const spec = conRespaldoDelCatalogo(ESPECIFICACION_VACIA, respaldo);
    expect(spec.identidad.nombre).toBe('Larry');
    expect(spec.identidad.proposito).toBe('Mide tu web.');
    expect(spec.hace).toHaveLength(2);
  });

  it('lo que el cliente escribió no se toca', () => {
    const suya = leerEspecificacion({
      identidad: { nombre: 'Larry', tono: 'seco y directo', proposito: 'Lo mío' },
      hace: ['solo esto'],
    });
    const spec = conRespaldoDelCatalogo(suya, respaldo);
    expect(spec.identidad.tono).toBe('seco y directo');
    expect(spec.identidad.proposito).toBe('Lo mío');
    expect(spec.hace).toEqual(['solo esto']);
  });

  it('si tiene contenido pero se quedó sin nombre, se pone el del agente', () => {
    // El síntoma que reportó el cliente: el título decía «Larry» y el
    // formulario de debajo, nada.
    const sinNombre = leerEspecificacion({ identidad: { tono: 'cercano' }, hace: ['medir'] });
    const spec = conRespaldoDelCatalogo(sinNombre, respaldo);
    expect(spec.identidad.nombre).toBe('Larry');
    expect(spec.hace).toEqual(['medir']);
  });

  it('un prompt escrito a mano cuenta como ficha con contenido', () => {
    const manual = leerEspecificacion({ instruccionesManuales: 'Eres un agente muy específico.' });
    expect(fichaVacia(manual)).toBe(false);
    expect(conRespaldoDelCatalogo(manual, respaldo).instruccionesManuales).toBe(
      'Eres un agente muy específico.',
    );
  });

  it('reconoce una ficha vacía y una que no lo está', () => {
    expect(fichaVacia(ESPECIFICACION_VACIA)).toBe(true);
    expect(fichaVacia(leerEspecificacion({ escalar: ['cuando lo pidan'] }))).toBe(false);
  });
});
