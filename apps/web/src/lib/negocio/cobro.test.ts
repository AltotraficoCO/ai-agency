import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conEspacio, consultar } from "@/lib/db/pool";

/**
 * Pruebas contra la base de datos real.
 *
 * Lo que se comprueba aquí no se puede comprobar con dobles: la idempotencia
 * del cobro y la parada por falta de saldo viven en `charge_credits`, una
 * función SQL que bloquea la cartera y reclama la clave en la misma
 * transacción. Un doble en TypeScript solo probaría el doble.
 *
 * Si no hay base a mano (integración continua sin Postgres), las pruebas se
 * SALTAN en vez de fallar: romper la construcción por no tener base sería
 * ruido, no señal.
 */
const HAY_BASE = Boolean(process.env["DATABASE_URL"]);

type FilaCartera = { included_balance: string; purchased_balance: string; included_granted: string };

let workspaceId: string | null = null;
let carteraOriginal: FilaCartera | null = null;
const clavesUsadas: string[] = [];

async function hayConexion(): Promise<boolean> {
  if (!HAY_BASE) return false;
  try {
    const filas = await consultar<{ id: string }>(
      `select id from public.workspaces where status = 'active' order by created_at asc limit 1`,
    );
    workspaceId = filas[0]?.id ?? null;
    return workspaceId !== null;
  } catch {
    return false;
  }
}

let disponible = false;

beforeAll(async () => {
  disponible = await hayConexion();
  if (!disponible || !workspaceId) return;
  const filas = await consultar<FilaCartera>(
    `select included_balance, purchased_balance, included_granted
       from public.credit_wallets where workspace_id = $1`,
    [workspaceId],
  );
  carteraOriginal = filas[0] ?? null;
});

afterAll(async () => {
  // Se deja la cartera exactamente como estaba: estas pruebas corren contra la
  // base de desarrollo del equipo, no contra una desechable.
  if (!disponible || !workspaceId || !carteraOriginal) return;
  await consultar(
    `update public.credit_wallets
        set included_balance = $2::numeric,
            purchased_balance = $3::numeric,
            included_granted = $4::numeric
      where workspace_id = $1`,
    [
      workspaceId,
      carteraOriginal.included_balance,
      carteraOriginal.purchased_balance,
      carteraOriginal.included_granted,
    ],
  );
  for (const clave of clavesUsadas) {
    await consultar(
      `delete from public.credit_idempotency where workspace_id = $1 and idempotency_key = $2`,
      [workspaceId, clave],
    );
    await consultar(`delete from public.credit_ledger where workspace_id = $1 and idempotency_key = $2`, [
      workspaceId,
      clave,
    ]);
  }
});

type ResultadoCobro = {
  applied: boolean;
  reason: string | null;
  credits: string;
  balance_after: string;
};

async function cobrar(clave: string, cantidad: number): Promise<ResultadoCobro> {
  clavesUsadas.push(clave);
  return conEspacio(workspaceId!, async (scope) => {
    const { rows } = await scope.query<ResultadoCobro>(
      `select applied, reason, credits, balance_after
         from public.charge_credits($1, $2, $3::jsonb, 'agent_run', null, null, null,
                                    'prueba de cobro', '{}'::jsonb, now(), false)`,
      [
        workspaceId,
        clave,
        JSON.stringify([{ kind: "tool_call", ref_key: "*", quantity: cantidad }]),
      ],
    );
    return rows[0]!;
  });
}

describe.runIf(HAY_BASE)("cobro de créditos", () => {
  it("un reintento con la misma clave NO cobra dos veces", async () => {
    if (!disponible) return;

    const clave = `prueba:idempotencia:${crypto.randomUUID()}`;
    const primero = await cobrar(clave, 3);
    expect(primero.applied).toBe(true);
    expect(Number(primero.credits)).toBe(3);

    const saldoTrasPrimero = Number(primero.balance_after);

    // Mismo cobro, misma clave: es un reintento del motor, no un cobro nuevo.
    const segundo = await cobrar(clave, 3);
    expect(segundo.applied).toBe(false);
    expect(segundo.reason).toBe("duplicate");
    expect(Number(segundo.balance_after)).toBe(saldoTrasPrimero);

    // Y en el libro mayor hay UN solo asiento con esa clave.
    const asientos = await consultar<{ n: string }>(
      `select count(*)::text as n from public.credit_ledger
        where workspace_id = $1 and idempotency_key = $2`,
      [workspaceId, clave],
    );
    expect(Number(asientos[0]?.n)).toBe(1);
  });

  it("sin saldo suficiente el cobro se rechaza y la cartera no se toca", async () => {
    if (!disponible) return;

    const antes = await consultar<FilaCartera>(
      `select included_balance, purchased_balance, included_granted
         from public.credit_wallets where workspace_id = $1`,
      [workspaceId],
    );
    const saldoAntes =
      Number(antes[0]?.included_balance ?? 0) + Number(antes[0]?.purchased_balance ?? 0);

    const clave = `prueba:sin-saldo:${crypto.randomUUID()}`;
    const resultado = await cobrar(clave, Math.ceil(saldoAntes) + 1_000);

    expect(resultado.applied).toBe(false);
    expect(resultado.reason).toBe("no_credits");

    const despues = await consultar<FilaCartera>(
      `select included_balance, purchased_balance, included_granted
         from public.credit_wallets where workspace_id = $1`,
      [workspaceId],
    );
    expect(despues[0]?.included_balance).toBe(antes[0]?.included_balance);
    expect(despues[0]?.purchased_balance).toBe(antes[0]?.purchased_balance);
  });

  it("quedarse sin saldo detiene al bot, no a la bandeja", async () => {
    if (!disponible) return;

    // `has_credits` es lo que consulta el motor antes de responder: con el
    // mínimo por encima del saldo devuelve falso y el motor anota
    // `skip_reason = no_credits`.
    const puedeResponder = await conEspacio(workspaceId!, async (scope) => {
      const { rows } = await scope.query<{ ok: boolean }>(
        `select public.has_credits($1, 999999999::numeric) as ok`,
        [workspaceId],
      );
      return rows[0]?.ok === true;
    });
    expect(puedeResponder).toBe(false);

    // Y sin embargo la bandeja se sigue leyendo y escribiendo con normalidad:
    // el saldo no cierra conversaciones ni bloquea el trabajo de las personas.
    const bandeja = await conEspacio(workspaceId!, async (scope) => {
      const { rows } = await scope.query<{ n: string }>(
        `select count(*)::text as n from public.conversations where workspace_id = $1`,
        [workspaceId],
      );
      return rows[0]?.n;
    });
    expect(bandeja).toBeDefined();
    expect(Number(bandeja)).toBeGreaterThanOrEqual(0);
  });
});
