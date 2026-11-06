/**
 * La clave de la cartera de modelos, vista desde el panel.
 *
 * Lo puro (reconocer una clave bien formada) va aparte de lo que sale a la red
 * (preguntarle a OpenRouter si la acepta), para poder probar lo primero sin
 * tocar lo segundo.
 */

export type ClaveValidada = { ok: true; clave: string } | { ok: false; motivo: string };

/** Una clave de OpenRouter empieza por `sk-or-` y no lleva espacios. */
export function validarClaveDeCartera(entrada: unknown): ClaveValidada {
  const clave = String(entrada ?? "").trim();
  if (!clave) return { ok: false, motivo: "Pega la clave de OpenRouter." };
  if (/\s/.test(clave)) return { ok: false, motivo: "La clave no puede llevar espacios: revisa que la copiaste entera." };
  if (!clave.startsWith("sk-or-")) {
    return { ok: false, motivo: "No parece una clave de OpenRouter: empiezan por sk-or-." };
  }
  if (clave.length < 20) return { ok: false, motivo: "La clave está incompleta." };
  return { ok: true, clave };
}

export type RespuestaDeCartera =
  | { estado: "acepta"; etiqueta: string | null; limiteUsd: number | null; gastadoUsd: number | null }
  | { estado: "rechaza" }
  | { estado: "sin-respuesta" };

/**
 * Le pregunta a OpenRouter por la clave. Distingue «no la acepta» (hay que
 * corregirla) de «no responde» (no se puede saber ahora), porque el panel hace
 * cosas distintas con cada una.
 */
export async function comprobarClaveDeCartera(
  clave: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RespuestaDeCartera> {
  try {
    const respuesta = await fetchImpl("https://openrouter.ai/api/v1/auth/key", {
      headers: { authorization: `Bearer ${clave}` },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (respuesta.status === 401 || respuesta.status === 403) return { estado: "rechaza" };
    if (!respuesta.ok) return { estado: "sin-respuesta" };
    const cuerpo = (await respuesta.json()) as {
      data?: { label?: unknown; limit?: unknown; usage?: unknown };
    };
    const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      estado: "acepta",
      etiqueta: typeof cuerpo.data?.label === "string" ? cuerpo.data.label : null,
      limiteUsd: numero(cuerpo.data?.limit),
      gastadoUsd: numero(cuerpo.data?.usage),
    };
  } catch {
    return { estado: "sin-respuesta" };
  }
}
