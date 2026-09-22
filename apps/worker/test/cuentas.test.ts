/**
 * De las filas de `connections` a las plataformas que ve el agente.
 *
 * Es la costura entre la base de datos y los adaptadores reales, y es donde se
 * decide algo que el cliente nota: que una conexión rota de las tres no le
 * deje al agente sin las otras dos. Se prueba con un `SqlExecutor` de mentira
 * porque lo que importa aquí no es el SQL sino qué se hace con lo que devuelve.
 */
import { describe, expect, it } from "vitest";
import { encryptJson, deriveKey } from "@strappy/webmaster";
import { CuentasPostgres } from "../src/adaptadores/cuentas.js";
import type { SqlExecutor } from "../src/ports.js";

const CLAVE = deriveKey("una-clave-de-pruebas-suficientemente-larga");
const OTRA_CLAVE = deriveKey("otra-clave-distinta-igual-de-larga-aun");

type Fila = {
  id: string;
  provider: string;
  credentials_encrypted: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
};

/** Contesta el nombre del espacio a la primera consulta y las conexiones a la segunda. */
function sql(conexiones: readonly Fila[], nombre = "Bufete Pérez"): SqlExecutor {
  return {
    async query<T>(texto: string): Promise<{ rows: T[] }> {
      if (texto.includes("public.workspaces")) return { rows: [{ nombre }] as T[] };
      return { rows: conexiones as unknown as T[] };
    },
  };
}

function fila(provider: string, creds: unknown, extra: Partial<Fila> = {}): Fila {
  return {
    id: `con_${provider}`,
    provider,
    credentials_encrypted: encryptJson(creds, CLAVE),
    metadata: null,
    status: "active",
    ...extra,
  };
}

const GOOGLE = {
  clientId: "id-publico-de-la-app",
  clientSecret: "secreto-de-la-app",
  refreshToken: "refresco-del-cliente",
};
const META = { accessToken: "token-de-meta-larguisimo" };
const TIKTOK = { accessToken: "token-de-tiktok", appId: "a", secret: "s" };

describe("las cuentas de publicidad de un espacio", () => {
  it("monta una plataforma por conexión activa", async () => {
    const cuentas = new CuentasPostgres(
      sql([fila("google_ads", GOOGLE), fila("meta_ads", META), fila("tiktok_ads", TIKTOK)]),
      CLAVE,
    );
    const cargado = await cuentas.cargar({ workspaceId: "w1", conexionId: null });

    expect(cargado.ads.map((a) => a.plataforma)).toEqual(["google_ads", "meta_ads", "tiktok_ads"]);
    expect(cargado.negocio).toBe("Bufete Pérez");
    expect(cargado.ads.every((a) => a.puedeEscribir)).toBe(true);
  });

  it("un espacio sin nada conectado no falla: llega vacío", async () => {
    const cargado = await new CuentasPostgres(sql([]), CLAVE).cargar({
      workspaceId: "w1",
      conexionId: null,
    });
    expect(cargado.ads).toEqual([]);
    expect(cargado.conexionId).toBeNull();
  });

  it("una conexión que no se puede descifrar no se lleva por delante a las demás", async () => {
    const rota = fila("google_ads", GOOGLE);
    rota.credentials_encrypted = encryptJson(GOOGLE, OTRA_CLAVE);

    const cargado = await new CuentasPostgres(sql([rota, fila("meta_ads", META)]), CLAVE).cargar({
      workspaceId: "w1",
      conexionId: null,
    });
    expect(cargado.ads.map((a) => a.plataforma)).toEqual(["meta_ads"]);
  });

  it("si la plataforma está dos veces, gana la reconexión más reciente", async () => {
    // La consulta devuelve ordenado por `updated_at` descendente.
    const nueva = fila("meta_ads", META, { id: "con_nueva" });
    const vieja = fila("meta_ads", { accessToken: "token-viejo" }, { id: "con_vieja" });

    const cargado = await new CuentasPostgres(sql([nueva, vieja]), CLAVE).cargar({
      workspaceId: "w1",
      conexionId: null,
    });
    expect(cargado.ads).toHaveLength(1);
    expect(cargado.conexionId).toBe("con_nueva");
    expect(cargado.secretos).toContain(META.accessToken);
    expect(cargado.secretos).not.toContain("token-viejo");
  });

  it("respeta la conexión del encargo por encima de la más reciente", async () => {
    const cargado = await new CuentasPostgres(
      sql([fila("meta_ads", META), fila("google_ads", GOOGLE)]),
      CLAVE,
    ).cargar({ workspaceId: "w1", conexionId: "con_google_ads" });
    expect(cargado.conexionId).toBe("con_google_ads");
  });

  it("una conexión marcada de solo lectura no puede escribir", async () => {
    const cargado = await new CuentasPostgres(
      sql([fila("meta_ads", META, { metadata: { solo_lectura: true } })]),
      CLAVE,
    ).cargar({ workspaceId: "w1", conexionId: null });
    expect(cargado.ads[0]?.puedeEscribir).toBe(false);
  });

  it("saca los secretos para que la tapadera pueda taparlos", async () => {
    const cargado = await new CuentasPostgres(sql([fila("google_ads", GOOGLE)]), CLAVE).cargar({
      workspaceId: "w1",
      conexionId: null,
    });
    // El refresco y el secreto de la app abren la cuenta del cliente: no pueden
    // aparecer en un paso ni en el texto de un error. El `clientId` no es
    // secreto y no tiene por qué taparse.
    expect(cargado.secretos).toEqual(expect.arrayContaining(["refresco-del-cliente", "secreto-de-la-app"]));
    expect(cargado.secretos).not.toContain("id-publico-de-la-app");
  });

  it("no mira nada que no sea una plataforma de anuncios", async () => {
    const cargado = await new CuentasPostgres(
      sql([fila("alegra", { usuario: "a", secreto: "b" }), fila("meta_ads", META)]),
      CLAVE,
    ).cargar({ workspaceId: "w1", conexionId: null });
    expect(cargado.ads.map((a) => a.plataforma)).toEqual(["meta_ads"]);
  });

  it("por defecto NO es primer contacto: todo lo que gasta pasa por aprobación", async () => {
    const normal = await new CuentasPostgres(sql([fila("meta_ads", META)]), CLAVE).cargar({
      workspaceId: "w1",
      conexionId: null,
    });
    expect(normal.primerContacto).toBeUndefined();

    const enPruebas = await new CuentasPostgres(
      sql([fila("meta_ads", META, { metadata: { primer_contacto: true } })]),
      CLAVE,
    ).cargar({ workspaceId: "w1", conexionId: null });
    expect(enPruebas.primerContacto).toBe(true);
  });
});
