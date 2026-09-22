/**
 * Los adaptadores reales, contra un `fetch` de mentira.
 *
 * Lo que se verifica aquí no es que las URLs estén bien escritas —eso solo lo
 * dirá la API real el día que aprueben los accesos— sino las traducciones que,
 * mal hechas, le dan al cliente una cifra falsa sobre su propio dinero: los
 * micros de Google, los centavos de Meta, el error con cara de éxito de TikTok
 * y el presupuesto que no es diario.
 */
import { describe, expect, it } from "vitest";
import { AdsApiError, crearAdsGoogle, crearAdsMeta, crearAdsTiktok } from "../src/adaptadores/index.js";

const PERIODO = { desde: "2026-09-05", hasta: "2026-09-11" };
const CATALOGO = { desde: "1970-01-01", hasta: "1970-01-01" };

type Llamada = { url: string; init: RequestInit };

/** Un `fetch` que responde lo que se le diga y apunta lo que le piden. */
function fetchFalso(rutas: readonly { contiene: string; cuerpo: unknown; status?: number }[]) {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    llamadas.push({ url, init });
    const ruta = rutas.find((r) => url.includes(r.contiene));
    if (!ruta) throw new Error(`El test no esperaba una llamada a ${url}`);
    return new Response(JSON.stringify(ruta.cuerpo), {
      status: ruta.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: f, llamadas };
}

const TOKEN_GOOGLE = { contiene: "oauth2.googleapis.com/token", cuerpo: { access_token: "t_1", expires_in: 3600 } };

describe("Google Ads", () => {
  const CUENTAS = {
    contiene: "listAccessibleCustomers",
    cuerpo: { resourceNames: ["customers/1234567890"] },
  };

  function busqueda(cuerpo: unknown) {
    return { contiene: "googleAds:search", cuerpo };
  }

  const FICHA = {
    results: [
      {
        customerClient: {
          id: "1234567890",
          descriptiveName: "Bufete Pérez",
          currencyCode: "cop",
          manager: false,
        },
      },
    ],
  };

  it("convierte los micros en dinero de verdad", async () => {
    const { fetch } = fetchFalso([
      TOKEN_GOOGLE,
      CUENTAS,
      busqueda({
        results: [
          {
            campaign: { id: "c1", name: "Búsqueda", status: "ENABLED" },
            campaignBudget: { resourceName: "customers/1/campaignBudgets/9", amountMicros: "30000000" },
            metrics: {
              costMicros: "210000000",
              impressions: "12000",
              clicks: "320",
              conversions: 14,
              conversionsValue: 3_500_000,
            },
          },
        ],
      }),
    ]);
    const ads = crearAdsGoogle(credsGoogle(), { fetch });
    const campanas = await ads.campanas({ cuentaId: "123-456-7890", periodo: PERIODO });

    expect(campanas[0]?.presupuestoDiario).toBe(30);
    expect(campanas[0]?.metricas.gasto).toBe(210);
    expect(campanas[0]?.metricas.conversiones).toBe(14);
    expect(campanas[0]?.estado).toBe("activa");
  });

  it("no lista las cuentas gestoras: no tienen campañas", async () => {
    const { fetch } = fetchFalso([
      TOKEN_GOOGLE,
      CUENTAS,
      busqueda({
        results: [
          { customerClient: { id: "1", descriptiveName: "Agencia", currencyCode: "USD", manager: true } },
          { customerClient: { id: "2", descriptiveName: "Cliente", currencyCode: "USD", manager: false } },
        ],
      }),
    ]);
    const cuentas = await crearAdsGoogle(credsGoogle(), { fetch }).cuentas();
    expect(cuentas.map((c) => c.id)).toEqual(["2"]);
  });

  it("si ninguna cuenta se deja leer, enseña lo que dijo Google en vez de «no tienes cuentas»", async () => {
    const { fetch } = fetchFalso([
      TOKEN_GOOGLE,
      CUENTAS,
      { ...busqueda({ error: { code: 403, message: "PERMISSION_DENIED: el proyecto no tiene acceso" } }), status: 403 },
    ]);
    await expect(crearAdsGoogle(credsGoogle(), { fetch }).cuentas()).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("escribe la moneda en mayúsculas aunque Google la mande en minúsculas", async () => {
    const { fetch } = fetchFalso([TOKEN_GOOGLE, CUENTAS, busqueda(FICHA)]);
    const cuentas = await crearAdsGoogle(credsGoogle(), { fetch }).cuentas();
    expect(cuentas[0]?.moneda).toBe("COP");
  });

  it("no pide métricas de 1970 cuando solo hace falta el catálogo", async () => {
    const { fetch, llamadas } = fetchFalso([
      TOKEN_GOOGLE,
      busqueda({ results: [{ campaign: { id: "c1", name: "X", status: "PAUSED" } }] }),
    ]);
    await crearAdsGoogle(credsGoogle(), { fetch }).campanas({ cuentaId: "1", periodo: CATALOGO });
    const consulta = String(llamadas.find((l) => l.url.includes("search"))?.init.body);
    expect(consulta).not.toContain("metrics.cost_micros");
    expect(consulta).not.toContain("1970");
  });

  it("se niega a tocar un presupuesto compartido con otras campañas", async () => {
    const { fetch } = fetchFalso([
      TOKEN_GOOGLE,
      busqueda({
        results: [
          {
            campaign: { id: "c1", name: "Búsqueda", status: "ENABLED" },
            campaignBudget: {
              resourceName: "customers/1/campaignBudgets/9",
              amountMicros: "30000000",
              explicitlyShared: true,
            },
          },
        ],
      }),
    ]);
    const ads = crearAdsGoogle(credsGoogle(), { fetch });
    await expect(
      ads.cambiarPresupuesto({ cuentaId: "1", campanaId: "c1", diario: 50 }),
    ).rejects.toThrow(/compartido/);
  });

  it("manda el presupuesto en micros y con su máscara", async () => {
    const { fetch, llamadas } = fetchFalso([
      TOKEN_GOOGLE,
      busqueda({
        results: [
          {
            campaign: { id: "c1", name: "Búsqueda", status: "ENABLED" },
            campaignBudget: { resourceName: "customers/1/campaignBudgets/9", amountMicros: "30000000" },
          },
        ],
      }),
      { contiene: "campaignBudgets:mutate", cuerpo: { results: [{}] } },
    ]);
    const cambio = await crearAdsGoogle(credsGoogle(), { fetch }).cambiarPresupuesto({
      cuentaId: "1",
      campanaId: "c1",
      diario: 50_000,
    });

    expect(cambio).toEqual({ campanaId: "c1", anterior: 30, nuevo: 50_000 });
    const mutacion = JSON.parse(String(llamadas.at(-1)?.init.body));
    expect(mutacion.operations[0].update.amountMicros).toBe(50_000_000_000);
    expect(mutacion.operations[0].updateMask).toBe("amount_micros");
  });

  it("una conexión de solo lectura no llega ni a llamar", async () => {
    const { fetch, llamadas } = fetchFalso([]);
    const ads = crearAdsGoogle(credsGoogle(), { fetch, soloLectura: true });
    expect(ads.puedeEscribir).toBe(false);
    await expect(ads.cambiarEstado({ cuentaId: "1", campanaId: "c1", estado: "pausada" })).rejects.toThrow(
      /solo lectura/,
    );
    expect(llamadas).toHaveLength(0);
  });

  it("dice que hay que reconectar cuando Google ya no da token", async () => {
    const { fetch } = fetchFalso([{ contiene: "oauth2.googleapis.com/token", cuerpo: {} }]);
    await expect(crearAdsGoogle(credsGoogle(), { fetch }).cuentas()).rejects.toThrow(/volver a conectar/);
  });
});

function credsGoogle() {
  return {
    clientId: "cid",
    clientSecret: "secreto",
    refreshToken: "refresco",
  };
}

describe("Meta", () => {
  const CUENTAS_COP = {
    contiene: "me/adaccounts",
    cuerpo: {
      data: [
        { id: "act_1", name: "Bufete Pérez", currency: "COP", account_status: 1 },
        { id: "act_2", name: "Cuenta cerrada", currency: "COP", account_status: 101 },
      ],
    },
  };

  it("lee los presupuestos en la unidad mínima de cada moneda", async () => {
    const campana = (moneda: string) => [
      {
        contiene: "me/adaccounts",
        cuerpo: { data: [{ id: "act_1", name: "Cuenta", currency: moneda, account_status: 1 }] },
      },
      {
        contiene: "/campaigns",
        cuerpo: {
          data: [{ id: "c1", name: "Mensajes", status: "ACTIVE", objective: "MESSAGES", daily_budget: "50000" }],
        },
      },
    ];

    const pesos = fetchFalso(campana("COP"));
    const enPesos = await crearAdsMeta({ accessToken: "t" }, { fetch: pesos.fetch }).campanas({
      cuentaId: "act_1",
      periodo: CATALOGO,
    });
    // En pesos no hay centavos: 50000 son cincuenta mil pesos.
    expect(enPesos[0]?.presupuestoDiario).toBe(50_000);

    const dolares = fetchFalso(campana("USD"));
    const enDolares = await crearAdsMeta({ accessToken: "t" }, { fetch: dolares.fetch }).campanas({
      cuentaId: "act_1",
      periodo: CATALOGO,
    });
    expect(enDolares[0]?.presupuestoDiario).toBe(500);
  });

  it("cuenta como resultado la acción del objetivo, no la suma de todas", async () => {
    const { fetch } = fetchFalso([
      CUENTAS_COP,
      {
        contiene: "/campaigns",
        cuerpo: { data: [{ id: "c1", name: "Mensajes", status: "ACTIVE", objective: "MESSAGES" }] },
      },
      {
        contiene: "/insights",
        cuerpo: {
          data: [
            {
              campaign_id: "c1",
              spend: "210000",
              impressions: "12000",
              clicks: "320",
              actions: [
                { action_type: "video_view", value: "4300" },
                { action_type: "post_engagement", value: "900" },
                { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "14" },
              ],
            },
          ],
        },
      },
    ]);
    const campanas = await crearAdsMeta({ accessToken: "t" }, { fetch }).campanas({
      cuentaId: "act_1",
      periodo: PERIODO,
    });
    expect(campanas[0]?.metricas.conversiones).toBe(14);
    expect(campanas[0]?.metricas.gasto).toBe(210_000);
  });

  it("deja fuera las cuentas que ya no están activas", async () => {
    const { fetch } = fetchFalso([CUENTAS_COP]);
    const cuentas = await crearAdsMeta({ accessToken: "t" }, { fetch }).cuentas();
    expect(cuentas.map((c) => c.id)).toEqual(["act_1"]);
  });

  it("explica que el presupuesto está en los conjuntos de anuncios", async () => {
    const { fetch } = fetchFalso([
      CUENTAS_COP,
      {
        contiene: "/campaigns",
        cuerpo: { data: [{ id: "c1", name: "Ventas", status: "ACTIVE", objective: "OUTCOME_SALES" }] },
      },
    ]);
    await expect(
      crearAdsMeta({ accessToken: "t" }, { fetch }).cambiarPresupuesto({
        cuentaId: "act_1",
        campanaId: "c1",
        diario: 60_000,
      }),
    ).rejects.toThrow(/conjunto de anuncios/);
  });

  it("manda el presupuesto en la unidad mínima al cambiarlo", async () => {
    const { fetch, llamadas } = fetchFalso([
      CUENTAS_COP,
      {
        contiene: "/campaigns",
        cuerpo: { data: [{ id: "c1", name: "Ventas", status: "ACTIVE", daily_budget: "50000" }] },
      },
      { contiene: "/c1", cuerpo: { success: true } },
    ]);
    const cambio = await crearAdsMeta({ accessToken: "t" }, { fetch }).cambiarPresupuesto({
      cuentaId: "act_1",
      campanaId: "c1",
      diario: 80_000,
    });
    expect(cambio.anterior).toBe(50_000);
    expect(JSON.parse(String(llamadas.at(-1)?.init.body))).toEqual({ daily_budget: "80000" });
  });

  it("un 400 de Meta llega con el cuerpo dentro del error", async () => {
    const { fetch } = fetchFalso([
      { contiene: "me/adaccounts", cuerpo: { error: { message: "Invalid OAuth token" } }, status: 400 },
    ]);
    await expect(crearAdsMeta({ accessToken: "t" }, { fetch }).cuentas()).rejects.toThrow(
      /Invalid OAuth token/,
    );
  });
});

describe("TikTok", () => {
  const ANUNCIANTES = {
    contiene: "oauth2/advertiser/get/",
    cuerpo: { code: 0, data: { list: [{ advertiser_id: "a1", advertiser_name: "Bufete" }] } },
  };
  const FICHA = {
    contiene: "advertiser/info/",
    cuerpo: { code: 0, data: { list: [{ advertiser_id: "a1", name: "Bufete Pérez", currency: "COP" }] } },
  };

  function creds() {
    return { accessToken: "t", appId: "app", secret: "secreto" };
  }

  it("trata como error una respuesta con code distinto de cero aunque sea un 200", async () => {
    const { fetch } = fetchFalso([
      {
        contiene: "oauth2/advertiser/get/",
        cuerpo: { code: 40105, message: "Access token is incorrect or has been revoked" },
      },
    ]);
    const error = await crearAdsTiktok(creds(), { fetch })
      .cuentas()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdsApiError);
    expect(String(error)).toMatch(/volver a conectar/);
  });

  it("lee el presupuesto diario y deja sin presupuesto el que es para toda la campaña", async () => {
    const { fetch } = fetchFalso([
      ANUNCIANTES,
      FICHA,
      {
        contiene: "campaign/get/",
        cuerpo: {
          code: 0,
          data: {
            list: [
              {
                campaign_id: "c1",
                campaign_name: "Diaria",
                operation_status: "ENABLE",
                budget: 50000,
                budget_mode: "BUDGET_MODE_DAY",
              },
              {
                campaign_id: "c2",
                campaign_name: "Total",
                operation_status: "ENABLE",
                budget: 1_500_000,
                budget_mode: "BUDGET_MODE_TOTAL",
              },
            ],
          },
        },
      },
    ]);
    const campanas = await crearAdsTiktok(creds(), { fetch }).campanas({
      cuentaId: "a1",
      periodo: CATALOGO,
    });
    expect(campanas[0]?.presupuestoDiario).toBe(50_000);
    expect(campanas[1]?.presupuestoDiario).toBeUndefined();
  });

  it("cruza las cifras del informe con las campañas", async () => {
    const { fetch } = fetchFalso([
      ANUNCIANTES,
      FICHA,
      {
        contiene: "campaign/get/",
        cuerpo: {
          code: 0,
          data: {
            list: [
              {
                campaign_id: "c1",
                campaign_name: "Promo",
                operation_status: "ENABLE",
                budget: 20000,
                budget_mode: "BUDGET_MODE_DAY",
              },
            ],
          },
        },
      },
      {
        contiene: "report/integrated/get/",
        cuerpo: {
          code: 0,
          data: {
            list: [
              {
                dimensions: { campaign_id: "c1" },
                metrics: { spend: "140000.00", impressions: "30000", clicks: "95", conversion: "3" },
              },
            ],
          },
        },
      },
    ]);
    const campanas = await crearAdsTiktok(creds(), { fetch }).campanas({
      cuentaId: "a1",
      periodo: PERIODO,
    });
    expect(campanas[0]?.metricas).toMatchObject({ gasto: 140_000, clics: 95, conversiones: 3 });
  });

  it("no pide el informe cuando solo hace falta el catálogo", async () => {
    const { fetch, llamadas } = fetchFalso([
      ANUNCIANTES,
      FICHA,
      { contiene: "campaign/get/", cuerpo: { code: 0, data: { list: [] } } },
    ]);
    await crearAdsTiktok(creds(), { fetch }).campanas({ cuentaId: "a1", periodo: CATALOGO });
    expect(llamadas.some((l) => l.url.includes("report/integrated"))).toBe(false);
  });

  it("pausa mandando DISABLE, que es como lo llama TikTok", async () => {
    const { fetch, llamadas } = fetchFalso([
      ANUNCIANTES,
      FICHA,
      {
        contiene: "campaign/get/",
        cuerpo: {
          code: 0,
          data: {
            list: [
              {
                campaign_id: "c1",
                campaign_name: "Promo",
                operation_status: "ENABLE",
                budget: 20000,
                budget_mode: "BUDGET_MODE_DAY",
              },
            ],
          },
        },
      },
      { contiene: "campaign/status/update/", cuerpo: { code: 0, data: {} } },
    ]);
    const cambio = await crearAdsTiktok(creds(), { fetch }).cambiarEstado({
      cuentaId: "a1",
      campanaId: "c1",
      estado: "pausada",
    });
    expect(cambio).toEqual({ campanaId: "c1", anterior: "activa", nuevo: "pausada" });
    expect(JSON.parse(String(llamadas.at(-1)?.init.body)).operation_status).toBe("DISABLE");
  });
});
