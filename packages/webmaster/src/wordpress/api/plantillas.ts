/**
 * Plantillas de Elementor (header, footer…) por la REST API, sin plugin.
 */
import type { WpCreds } from "../../ports.js";
import { type WpClientOptions, wp, exigirOk } from "./http.js";
import type { WpPostRaw } from "./tipos.js";

export type PlantillaElementor = {
  readonly id: number;
  readonly titulo: string;
  readonly tipo: string;
  readonly status: string;
};

const SIN_PLANTILLAS =
  "Este WordPress no expone las plantillas de Elementor por la API: no se pueden leer ni editar sin un plugin conector.";

function tipoDePlantilla(p: WpPostRaw): string {
  const tipo = p.meta?.["_elementor_template_type"];
  return typeof tipo === "string" ? tipo : "desconocido";
}

export async function listarPlantillasElementor(
  c: WpCreds,
  o: WpClientOptions = {},
): Promise<PlantillaElementor[]> {
  const res = await wp(c, o, "/wp/v2/elementor_library?per_page=50&context=edit&_fields=id,title,status,meta");
  if (res.status === 404) throw new Error(SIN_PLANTILLAS);
  const lista = (await exigirOk(res, "No pude listar las plantillas de Elementor")) as WpPostRaw[];
  return lista.map((p) => ({
    id: p.id,
    titulo: p.title?.raw ?? p.title?.rendered ?? "",
    tipo: tipoDePlantilla(p),
    status: p.status ?? "",
  }));
}

export async function leerPlantillaElementor(
  c: WpCreds,
  id: number,
  o: WpClientOptions = {},
): Promise<PlantillaElementor & { data: unknown[] }> {
  const res = await wp(c, o, `/wp/v2/elementor_library/${id}?context=edit&_fields=id,title,status,meta`);
  const p = (await exigirOk(res, `No pude leer la plantilla ${id}`)) as WpPostRaw;
  const crudo = p.meta?.["_elementor_data"];
  if (typeof crudo !== "string") throw new Error(SIN_PLANTILLAS);
  let data: unknown;
  try {
    data = crudo ? JSON.parse(crudo) : [];
  } catch {
    throw new Error(`El diseño de la plantilla ${id} no es JSON válido: no lo toco.`);
  }
  if (!Array.isArray(data)) throw new Error(`El diseño de la plantilla ${id} tiene una forma inesperada: no lo toco.`);
  return {
    id: p.id,
    titulo: p.title?.raw ?? p.title?.rendered ?? "",
    tipo: tipoDePlantilla(p),
    status: p.status ?? "",
    data,
  };
}

export async function escribirPlantillaElementor(
  c: WpCreds,
  id: number,
  data: readonly unknown[],
  o: WpClientOptions = {},
): Promise<{ cache: "limpiada" | "no disponible" }> {
  const texto = JSON.stringify(data);
  const res = await wp(c, o, `/wp/v2/elementor_library/${id}`, {
    method: "POST",
    body: JSON.stringify({ meta: { _elementor_data: texto } }),
  });
  await exigirOk(res, `No pude guardar la plantilla ${id}`);

  // WordPress ignora en silencio un meta que no acepta y responde 200 igual:
  // se relee para no dar por hecho un cambio que no quedó.
  const releida = await leerPlantillaElementor(c, id, o);
  if (JSON.stringify(releida.data) !== texto) {
    throw new Error(`WordPress respondió bien pero la plantilla ${id} no quedó guardada: el cambio no se aplicó.`);
  }

  // Elementor cachea el CSS y el HTML de sus plantillas; sin limpiarla el
  // cambio puede tardar en verse. Si la ruta no existe se sigue: es un extra.
  let cache: "limpiada" | "no disponible" = "no disponible";
  try {
    const limpiar = await wp(c, o, "/elementor/v1/cache", { method: "DELETE" });
    if (limpiar.ok) cache = "limpiada";
  } catch {
    /* sin limpieza de caché el cambio queda guardado igual */
  }
  return { cache };
}
