/**
 * Lo que el Diseñador puede mirar sin gastar un crédito ni tocar nada.
 *
 * Las dos existen por el mismo motivo: que la imagen parezca del negocio del
 * cliente. Una mira sus colores reales; la otra, si ya tiene una foto suya que
 * sirva, que siempre es mejor que una imagen inventada y además es gratis.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { MEDIDAS, PARA_QUE } from "../formatos.js";
import { requireMedios } from "../ports.js";
import { entorno } from "./comun.js";

export const imgVerEstilo = defineTool({
  slug: "img_ver_estilo",
  label: "Ver los colores de la marca",
  description:
    "Devuelve los colores y las tipografías REALES del sitio del cliente, medidos de su web, y los formatos con sus medidas. Toda imagen debe hacerse con esos colores.",
  whenToUse: "siempre lo primero, antes de dibujar nada",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 0,
  scopes: [SCOPES.disenoRead],
  effect: "read",
  kind: "system",
  async execute(ctx): Promise<Record<string, unknown>> {
    const { diseno } = entorno(ctx, "img_ver_estilo");
    const formatos = Object.entries(MEDIDAS).map(([nombre, m]) => ({
      formato: nombre,
      para_que: PARA_QUE[nombre as keyof typeof PARA_QUE],
      medida: `${m.ancho}x${m.alto}`,
    }));

    if (!diseno.estilo) {
      return {
        estilo_medido: false,
        formatos,
        nota: "No se pudieron medir los colores del sitio: usa una paleta sobria y dilo en el RESUMEN, pidiéndole al cliente que conecte su web.",
      };
    }
    return {
      estilo_medido: diseno.estilo.origen === "sitio",
      origen: diseno.estilo.origen,
      referencia: diseno.estilo.referencia ?? null,
      colores: diseno.estilo.colores,
      tipografia: diseno.estilo.tipografia,
      formatos,
      nota: "Usa estos colores tal cual: son los de su marca. Los formatos ya llevan la medida correcta, tú solo eliges el nombre.",
    };
  },
});

export const imgListarMedios = defineTool({
  slug: "img_listar_medios",
  label: "Revisar la biblioteca de imágenes",
  description:
    "Lista las imágenes que el cliente ya tiene en su sitio (id, título, texto alternativo). Una foto real del negocio vale más que una generada y no cuesta créditos.",
  whenToUse: "antes de dibujar, por si el cliente ya tiene una foto que sirva para lo que le piden",
  inputSchema: z.object({
    buscar: z
      .string()
      .max(80)
      .optional()
      .describe("Filtra por nombre o texto alternativo, p. ej. «equipo» u «oficina»."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.disenoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { diseno } = entorno(ctx, "img_listar_medios");
    const medios = requireMedios(diseno, "img_listar_medios");
    const lista = await medios.listar({ ...(input.buscar ? { buscar: input.buscar } : {}) });
    const imagenes = lista.filter((m) => m.tipo === "image");
    return {
      sitio: medios.sitio,
      imagenes: imagenes.map((m) => ({
        id: m.id,
        titulo: m.titulo,
        descripcion: m.alt ?? null,
        url: m.url,
      })),
      nota:
        imagenes.length === 0
          ? "Su biblioteca no tiene imágenes que encajen: tendrás que dibujar una."
          : "Si alguna sirve para lo que te piden, úsala y dilo: no hace falta gastar créditos dibujando.",
    };
  },
});

export const HERRAMIENTAS_LECTURA: readonly ToolDef<never, unknown>[] = [
  imgVerEstilo,
  imgListarMedios,
] as unknown as readonly ToolDef<never, unknown>[];
