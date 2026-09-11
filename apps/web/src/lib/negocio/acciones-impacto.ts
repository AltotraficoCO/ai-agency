"use server";

/**
 * Guardar la tarifa con la que se calcula el ahorro.
 *
 * Es la única cifra del «Impacto» que decide el negocio: cuánto le cuesta una
 * hora de una persona. Se guarda en `workspaces.settings.impacto`, como los
 * topes de gasto, sin migración. El espacio sale SIEMPRE de la sesión, nunca de
 * los argumentos: una acción de servidor es un endpoint público.
 */
import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import { consultar } from "@/lib/db/pool";
import { esMoneda } from "./impacto-calculo";

const PAPELES_QUE_EDITAN = new Set(["owner", "admin", "builder"]);

export type ResultadoTarifa = { ok: true } | { ok: false; error: string };

export async function accionGuardarTarifaImpacto(entrada: {
  tarifaHora: number;
  moneda: string;
  usdAMoneda: number | null;
}): Promise<ResultadoTarifa> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_EDITAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite cambiar la tarifa." };
  }

  if (!esMoneda(entrada.moneda)) return { ok: false, error: "Esa moneda no está disponible." };

  const tarifa = Number(entrada.tarifaHora);
  if (!Number.isFinite(tarifa) || tarifa <= 0 || tarifa > 100_000_000) {
    return { ok: false, error: "Escribe cuánto cuesta una hora de una persona, mayor que cero." };
  }

  let cambio: number | null = null;
  if (entrada.moneda !== "USD" && entrada.usdAMoneda !== null && entrada.usdAMoneda !== undefined) {
    const valor = Number(entrada.usdAMoneda);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 100_000_000) {
      return { ok: false, error: "El valor de 1 USD tiene que ser un número mayor que cero." };
    }
    cambio = valor;
  }

  // `workspaces` no admite escritura del rol acotado: igual que los topes, va
  // por la conexión transversal DESPUÉS de comprobar el papel.
  await consultar(
    `update public.workspaces
        set settings = settings || jsonb_build_object('impacto', $2::jsonb),
            updated_at = now()
      where id = $1`,
    [
      usuario.workspaceId,
      JSON.stringify({ tarifa_hora: tarifa, moneda: entrada.moneda, usd_a_moneda: cambio }),
    ],
  );

  revalidatePath("/negocio/impacto");
  return { ok: true };
}
