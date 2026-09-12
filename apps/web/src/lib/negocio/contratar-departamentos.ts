/**
 * El catálogo de contratación, ordenado como una plantilla.
 *
 * Contratar en Strappy es mirar una empresa y decidir a quién falta: por eso los
 * candidatos se agrupan por DEPARTAMENTO, con los mismos nombres y el mismo
 * orden que el menú, y no en una rejilla plana donde el Webmaster y el de
 * Marketing parecen la misma cosa.
 *
 * Dos reglas que vienen de cómo se vende el producto:
 *  · contratar no cuesta nada por sí mismo; se pagan los créditos que gaste
 *    trabajando, así que aquí no se calcula ningún precio por agente;
 *  · lo que un agente necesita conectado se dice ANTES de contratarlo, porque
 *    contratar un Webmaster sin sitio conectado deja a alguien con un empleado
 *    que no puede trabajar y la sensación de que el producto no sirve.
 *
 * Módulo puro, sin base de datos: se prueba con los agentes reales del catálogo.
 */
import { DEPARTAMENTOS, departamentoDeCategoria, type DepartamentoId } from "@strappy/ui";

/** Lo mínimo que hace falta de una ficha para colocarla y contarla. */
export type CandidatoUbicable = {
  readonly slug: string;
  readonly categoria: string;
  readonly contratado: boolean;
  readonly conexiones: readonly { readonly nombre: string; readonly lista: boolean }[];
};

/**
 * El orden en que se miran los departamentos al contratar.
 *
 * Es el del menú. `otros` va al final: es la red de seguridad para un agente con
 * categoría que todavía no conocemos, no un departamento de verdad.
 */
export const ORDEN_DEPARTAMENTOS: readonly DepartamentoId[] = [
  "comunicaciones",
  "marketing",
  "desarrollo",
  "financiero",
  "otros",
];

export type GrupoDeCandidatos<T extends CandidatoUbicable> = {
  readonly id: DepartamentoId;
  readonly etiqueta: string;
  readonly descripcion: string;
  /** Los que ya trabajan aquí, primero: se lee como una plantilla. */
  readonly contratados: readonly T[];
  /** Los que se pueden contratar. */
  readonly disponibles: readonly T[];
};

/**
 * Reparte el catálogo por departamentos.
 *
 * Un departamento sin NINGÚN candidato no se devuelve: enseñar «Comunicaciones»
 * vacío en esta pantalla sería mentir, porque los agentes de WhatsApp no se
 * contratan, se crean. Dentro de cada uno, primero quien ya está contratado.
 */
export function agruparPorDepartamento<T extends CandidatoUbicable>(
  catalogo: readonly T[],
): readonly GrupoDeCandidatos<T>[] {
  const grupos: GrupoDeCandidatos<T>[] = [];

  for (const id of ORDEN_DEPARTAMENTOS) {
    const suyos = catalogo.filter((f) => departamentoDeCategoria(f.categoria) === id);
    if (suyos.length === 0) continue;

    const ficha = DEPARTAMENTOS[id];
    grupos.push({
      id,
      etiqueta: ficha.etiqueta,
      descripcion: ficha.descripcion,
      contratados: suyos.filter((f) => f.contratado),
      disponibles: suyos.filter((f) => !f.contratado),
    });
  }

  return grupos;
}

/** Lo que le falta conectado para poder trabajar. */
export function conexionesPendientes(candidato: CandidatoUbicable): readonly string[] {
  return candidato.conexiones.filter((c) => !c.lista).map((c) => c.nombre);
}

/**
 * El resumen de la plantilla: «2 de 3 puestos cubiertos».
 *
 * Se cuenta sobre TODO el catálogo, no por departamento, porque es la frase que
 * se lee de un vistazo al entrar.
 */
export function resumenDePlantilla(catalogo: readonly CandidatoUbicable[]): {
  readonly contratados: number;
  readonly total: number;
} {
  return {
    contratados: catalogo.filter((f) => f.contratado).length,
    total: catalogo.length,
  };
}
