/**
 * Lo que el Velocista puede mirar sin pedir permiso a nadie.
 *
 * Todas son de solo lectura y devuelven las cifras YA interpretadas: los
 * segundos escritos, la frase que explica qué significan y de dónde salen. El
 * modelo no hace cuentas —se equivoca— ni decide qué es lento —cambiaría de
 * criterio cada vez—.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import {
  comparar,
  diagnosticar,
  imagenesPesadas,
  pesoDeMas,
  tamano,
  tieneCache,
  titularDe,
  PLUGINS_DE_CACHE,
} from "../analisis.js";
import { requireRendimiento, requireSitio, type Dispositivo } from "../ports.js";
import { entorno, ultimaMedicion, urlDelSitio } from "./comun.js";

const dispositivo = z
  .enum(["movil", "escritorio"])
  .default("movil")
  .describe("Dónde medir. Por defecto celular: es donde entra la mayoría y donde se nota.");

const ruta = z
  .string()
  .max(300)
  .default("/")
  .describe("Ruta de la página dentro del sitio, como / o /servicios/. Nunca un dominio completo.");

export const velocidadMedir = defineTool({
  slug: "velocidad_medir",
  label: "Medir la velocidad de una página",
  description:
    "Mide cuánto tarda en cargar una página del sitio y qué la frena. Devuelve los tiempos ya escritos en segundos, qué significan, y si vienen de gente real o de una prueba.",
  whenToUse: "siempre lo primero: sin medir no se puede decir si una página va lenta",
  inputSchema: z.object({ ruta, dispositivo }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.velocidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { velocidad } = entorno(ctx, "velocidad_medir");
    const medidor = requireRendimiento(velocidad, "velocidad_medir");
    const base = velocidad.sitio?.url;
    if (!base) {
      throw new Error(
        "No sé cuál es la web del cliente: no hay sitio conectado. Díselo en el RESUMEN en vez de medir a ciegas.",
      );
    }
    const url = urlDelSitio(base, input.ruta);
    const medicion = await medidor.medir({ url, dispositivo: input.dispositivo as Dispositivo });
    // Se guarda para poder comparar el antes y el después dentro de esta tarea.
    velocidad.historial.push(medicion);

    const d = diagnosticar(medicion);
    return {
      url,
      dispositivo: input.dispositivo,
      titular: titularDe(d),
      veredicto: d.veredicto,
      lo_que_pasa: d.frases,
      de_donde_sale:
        d.origen === "campo"
          ? "De gente que entró de verdad a tu web en los últimos días."
          : "De una prueba: esta página todavía no tiene visitas suficientes para que Google publique datos reales.",
      que_la_frena: d.frenos.map((f) => ({
        que_pasa: f.quePasa,
        se_arregla_desde:
          f.quienLoArregla === "nosotros"
            ? "tu web"
            : f.quienLoArregla === "hosting"
              ? "tu hosting (no se puede desde WordPress)"
              : "depende: hay que mirarlo",
        cuanto_se_ganaria: f.ahorroMs ? `${(f.ahorroMs / 1000).toFixed(1).replace(".", ",")} segundos` : null,
        cuanto_menos_pesaria: f.ahorroBytes ? tamano(f.ahorroBytes) : null,
      })),
      avisos: d.avisos,
      medido_con: medidor.fuente,
    };
  },
});

export const velocidadListarPaginas = defineTool({
  slug: "velocidad_listar_paginas",
  label: "Ver qué páginas tiene la web",
  description:
    "Lista las páginas publicadas del sitio, para elegir cuáles medir. La portada suele ir mejor que las demás.",
  whenToUse:
    "cuando el cliente no diga qué página le preocupa y quieras proponerle medir la que más le importa al negocio",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.sitioRead],
  effect: "read",
  kind: "http",
  async execute(ctx): Promise<Record<string, unknown>> {
    const { velocidad } = entorno(ctx, "velocidad_listar_paginas");
    const sitio = requireSitio(velocidad, "velocidad_listar_paginas");
    const paginas = await sitio.paginas();
    return {
      sitio: sitio.url,
      paginas: paginas.map((p) => ({ titulo: p.titulo, url: p.url })),
      nota:
        paginas.length > 1
          ? "Mide la portada y, además, la página que más le importe al negocio: suelen ir muy distinto."
          : undefined,
    };
  },
});

export const velocidadRevisarImagenes = defineTool({
  slug: "velocidad_revisar_imagenes",
  label: "Revisar el peso de las imágenes",
  description:
    "Mira la biblioteca de imágenes del sitio y devuelve las que pesan de más, con su nombre y su peso. Es la causa más común de una web lenta.",
  whenToUse: "después de medir, para poder decirle al cliente qué imágenes concretas están frenando su web",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.sitioRead],
  effect: "read",
  kind: "http",
  async execute(ctx): Promise<Record<string, unknown>> {
    const { velocidad } = entorno(ctx, "velocidad_revisar_imagenes");
    const sitio = requireSitio(velocidad, "velocidad_revisar_imagenes");
    const medios = await sitio.medios();
    const pesadas = imagenesPesadas(medios);
    const deMas = pesoDeMas(pesadas);
    return {
      total_imagenes: medios.length,
      pesadas: pesadas.map((i) => ({
        id: i.id,
        titulo: i.titulo,
        peso: i.bytes ? tamano(i.bytes) : "desconocido",
        por_que: i.motivo,
      })),
      resumen_legible:
        pesadas.length === 0
          ? "Las imágenes de tu web están bien de peso: por aquí no se pierde tiempo."
          : `Hay ${pesadas.length} ${pesadas.length === 1 ? "imagen que pesa" : "imágenes que pesan"} de más. ` +
            `Entre todas se descargan unos ${tamano(deMas)} que se podrían ahorrar.`,
      nota: "Yo no comprimo imágenes: puedo pedírselo al Webmaster o al diseñador, si el cliente los tiene contratados.",
    };
  },
});

export const velocidadRevisarPlugins = defineTool({
  slug: "velocidad_revisar_plugins",
  label: "Revisar los complementos de la web",
  description:
    "Lista los complementos instalados y dice si hay caché activa. La caché es el cambio que más acelera un WordPress.",
  whenToUse: "después de medir, para saber si falta caché y qué complementos podrían estar pesando",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.sitioRead],
  effect: "read",
  kind: "http",
  async execute(ctx): Promise<Record<string, unknown>> {
    const { velocidad } = entorno(ctx, "velocidad_revisar_plugins");
    const sitio = requireSitio(velocidad, "velocidad_revisar_plugins");
    const plugins = await sitio.plugins();
    const cache = tieneCache(plugins);
    const activos = plugins.filter((p) => p.activo);
    return {
      activos: activos.map((p) => ({ slug: p.slug, nombre: p.nombre })),
      inactivos: plugins.filter((p) => !p.activo).map((p) => ({ slug: p.slug, nombre: p.nombre })),
      cache_activa: cache.activo,
      resumen_legible: cache.activo
        ? `Tu web ya tiene caché (${cache.cual}): las páginas se guardan hechas y no se rehacen en cada visita.`
        : "Tu web no tiene caché. Es lo que más acelera un WordPress: en vez de rehacer la página para cada visitante, se guarda hecha.",
      puedo_instalar_cache: !cache.activo && sitio.puedeEscribir ? PLUGINS_DE_CACHE[0].slug : null,
      nota: "Nunca desactivo un complemento por mi cuenta: puede ser justo el que cobra los pedidos.",
    };
  },
});

export const velocidadComparar = defineTool({
  slug: "velocidad_comparar",
  label: "Comparar antes y después",
  description:
    "Vuelve a medir una página y la compara con la medición anterior de esta misma tarea. Enseña la diferencia real, sin promesas.",
  whenToUse: "solo después de haber aplicado un cambio aprobado, para enseñar si mejoró de verdad",
  inputSchema: z.object({ ruta, dispositivo }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.velocidadRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { velocidad } = entorno(ctx, "velocidad_comparar");
    const medidor = requireRendimiento(velocidad, "velocidad_comparar");
    const base = velocidad.sitio?.url;
    if (!base) throw new Error("No hay sitio conectado: no puedo comparar nada.");
    const url = urlDelSitio(base, input.ruta);
    const antes = ultimaMedicion(velocidad, url, input.dispositivo as Dispositivo);
    if (!antes) {
      throw new Error(
        `No tengo una medición anterior de ${url} en ${input.dispositivo}. Mide primero con velocidad_medir, aplica el cambio y entonces compara.`,
      );
    }
    const despues = await medidor.medir({ url, dispositivo: input.dispositivo as Dispositivo });
    velocidad.historial.push(despues);
    const c = comparar(antes, despues);
    return {
      url,
      dispositivo: input.dispositivo,
      mejoro: c.mejoro,
      resumen_legible: c.frase,
      nota: "Esto compara dos pruebas hechas hoy. Lo que viven tus visitantes tarda unos días en reflejarse.",
    };
  },
});

export const HERRAMIENTAS_LECTURA: readonly ToolDef<never, unknown>[] = [
  velocidadMedir,
  velocidadListarPaginas,
  velocidadRevisarImagenes,
  velocidadRevisarPlugins,
  velocidadComparar,
] as unknown as readonly ToolDef<never, unknown>[];
