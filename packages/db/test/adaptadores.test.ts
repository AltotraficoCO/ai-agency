/**
 * Pruebas de los adaptadores con lógica sutil.
 *
 * No se prueban los que solo traducen una fila a un objeto: eso lo cubre el
 * compilador. Se prueban los tres sitios donde equivocarse sale caro y en
 * silencio: el lock por conversación, la idempotencia del cobro y el
 * aislamiento entre espacios.
 *
 * Necesitan un Postgres de verdad, porque lo que se prueba VIVE en Postgres:
 * `pg_try_advisory_xact_lock`, la RLS y la función `charge_credits`. Un doble
 * en memoria pasaría estas pruebas y no probaría nada.
 *
 *   TEST_DATABASE_URL=postgresql://... pnpm --filter @strappy/db test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createWorkerClient, type SqlPool, type TenantScope } from '../src/client.js';
import { crearCreditLedger } from '../src/adapters/credits.js';
import { crearConversationLock } from '../src/adapters/lock.js';
import { crearConversationStore, estadoDeMando } from '../src/adapters/conversations.js';
import { componerInstrucciones, leerEspecificacion } from '../src/adapters/spec.js';

const URL_PRUEBAS = process.env['TEST_DATABASE_URL'];

describe('composición del prompt', () => {
  it('es determinista y coloca cada campo bajo su encabezado', () => {
    const spec = leerEspecificacion({
      identidad: { nombre: 'Espiga', idioma: 'español', tono: 'cercano', proposito: 'atender' },
      hace: ['Responde precios'],
      noHace: ['No inventa promociones'],
      recoger: [{ clave: 'nombre', etiqueta: 'nombre', obligatorio: true }],
      escalar: ['Si se queja'],
    });
    const uno = componerInstrucciones(spec);
    expect(componerInstrucciones(spec)).toBe(uno);
    expect(uno).toContain('## Qué no debe hacer');
    expect(uno.indexOf('## Identidad')).toBeLessThan(uno.indexOf('## Qué hace'));
    expect(uno).toContain('- No inventa promociones');
  });
});

describe('estado de mando', () => {
  it('trata «pending_human» como humano: el bot no debe escribir encima', () => {
    expect(
      estadoDeMando({ handover_state: 'pending_human', bot_enabled: true, bot_paused_until: null }),
    ).toBe('human');
  });

  it('un bot apagado en la conversación está en pausa, no en manos de nadie', () => {
    expect(
      estadoDeMando({ handover_state: 'bot', bot_enabled: false, bot_paused_until: null }),
    ).toBe('paused');
  });

  it('una pausa ya vencida no pausa nada', () => {
    expect(
      estadoDeMando({
        handover_state: 'bot',
        bot_enabled: true,
        bot_paused_until: new Date(Date.now() - 60_000),
      }),
    ).toBe('bot');
  });
});

describe.skipIf(!URL_PRUEBAS)('adaptadores contra Postgres', () => {
  let pool: pg.Pool;
  let cliente: ReturnType<typeof createWorkerClient>;
  const espacios: string[] = [];
  let conversacionA = '';

  const conEspacio = <T,>(ws: string, fn: (s: TenantScope) => Promise<T>) =>
    cliente.withWorkspace(ws, fn);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL_PRUEBAS, max: 6 });
    cliente = createWorkerClient(pool as unknown as SqlPool, { assumeRole: 'strappy_worker' });

    for (const nombre of ['Espacio de prueba A', 'Espacio de prueba B']) {
      // En dos sentencias: el disparador `handle_new_user` crea la membresía
      // DENTRO del insert, y un CTE no ve lo que escribe otro CTE hermano.
      const usuario = await pool.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data)
         values ($1, jsonb_build_object('organization', $2::text))
         returning id`,
        [`prueba-${Math.random().toString(36).slice(2)}@strappy.test`, nombre],
      );
      const { rows } = await pool.query<{ id: string }>(
        `select workspace_id as id from public.memberships where user_id = $1`,
        [usuario.rows[0]!.id],
      );
      espacios.push(rows[0]!.id);
    }

    conversacionA = await sembrarConversacion(pool, espacios[0]!);
  });

  afterAll(async () => {
    for (const ws of espacios) {
      await pool.query(
        `delete from auth.users u using public.memberships m
          where m.user_id = u.id and m.workspace_id = $1`,
        [ws],
      );
    }
    await pool.end();
  });

  it('el lock no deja entrar a dos a la vez y libera al cerrar la transacción', async () => {
    const [ws] = espacios;
    let segundoEntro: boolean | null = null;

    await conEspacio(ws!, async (scope) => {
      const lock = crearConversationLock(scope);
      expect(await lock.tryAdvisoryLock(conversacionA)).toBe(true);
      expect(
        await lock.acquireLease({
          conversationId: conversacionA,
          owner: 'primero',
          until: new Date(Date.now() + 60_000),
        }),
      ).toBe(true);

      // Otra transacción, otra conexión: es la situación real de dos workers.
      await conEspacio(ws!, async (otro) => {
        segundoEntro = await crearConversationLock(otro).tryAdvisoryLock(conversacionA);
      });

      await lock.releaseLease({ conversationId: conversacionA, owner: 'primero' });
    });

    expect(segundoEntro).toBe(false);

    // Cerrada la primera transacción, el advisory se soltó solo.
    await conEspacio(ws!, async (scope) => {
      expect(await crearConversationLock(scope).tryAdvisoryLock(conversacionA)).toBe(true);
    });
  });

  it('el lease no se lo puede quitar otro dueño mientras siga vigente', async () => {
    const [ws] = espacios;
    await conEspacio(ws!, async (scope) => {
      const lock = crearConversationLock(scope);
      expect(
        await lock.acquireLease({
          conversationId: conversacionA,
          owner: 'dueño-uno',
          until: new Date(Date.now() + 60_000),
        }),
      ).toBe(true);
      expect(
        await lock.acquireLease({
          conversationId: conversacionA,
          owner: 'dueño-dos',
          until: new Date(Date.now() + 60_000),
        }),
      ).toBe(false);
      // El propio dueño sí puede renovarlo: reintentar no debe bloquearse a sí mismo.
      expect(
        await lock.acquireLease({
          conversationId: conversacionA,
          owner: 'dueño-uno',
          until: new Date(Date.now() + 90_000),
        }),
      ).toBe(true);
      await lock.releaseLease({ conversationId: conversacionA, owner: 'dueño-uno' });
    });
  });

  it('cobrar dos veces con la misma clave cobra una sola vez', async () => {
    const [ws] = espacios;
    const clave = `prueba:${Math.random().toString(36).slice(2)}`;

    const primero = await conEspacio(ws!, async (scope) => {
      const libro = crearCreditLedger(scope);
      const saldoAntes = await libro.balance(ws!);
      const r = await libro.charge({
        workspaceId: ws!,
        kind: 'model',
        credits: 7,
        idempotencyKey: clave,
      });
      return { saldoAntes, r };
    });

    expect(primero.r.applied).toBe(true);
    expect(primero.r.balance).toBe(primero.saldoAntes - 7);

    const segundo = await conEspacio(ws!, async (scope) =>
      crearCreditLedger(scope).charge({
        workspaceId: ws!,
        kind: 'model',
        credits: 7,
        idempotencyKey: clave,
      }),
    );

    // `applied: false` aquí significa «ya estaba cobrado», no «no se pudo».
    expect(segundo.applied).toBe(false);
    expect(segundo.balance).toBe(primero.r.balance);
  });

  it('cobrar cero créditos no toca el libro', async () => {
    const [ws] = espacios;
    const { antes, resultado, despues } = await conEspacio(ws!, async (scope) => {
      const libro = crearCreditLedger(scope);
      const antes = await libro.balance(ws!);
      const resultado = await libro.charge({
        workspaceId: ws!,
        kind: 'model',
        credits: 0,
        idempotencyKey: `cero:${Math.random()}`,
      });
      return { antes, resultado, despues: await libro.balance(ws!) };
    });
    expect(resultado.applied).toBe(false);
    expect(despues).toBe(antes);
  });

  it('un espacio no ve la conversación de otro', async () => {
    const [, wsB] = espacios;
    const vista = await conEspacio(wsB!, async (scope) =>
      crearConversationStore(scope).load(conversacionA),
    );
    expect(vista).toBeNull();
  });

  it('la barrera de tenant salta antes de llegar a la base', async () => {
    const [wsA, wsB] = espacios;
    await expect(
      conEspacio(wsB!, async (scope) =>
        crearCreditLedger(scope).charge({
          workspaceId: wsA!,
          kind: 'model',
          credits: 1,
          idempotencyKey: 'cruce',
        }),
      ),
    ).rejects.toThrow(/tenant/i);
  });
});

/** Un canal, un contacto y una conversación mínimos para poder bloquear algo. */
async function sembrarConversacion(pool: pg.Pool, ws: string): Promise<string> {
  const canal = await pool.query<{ id: string }>(
    `insert into public.channels (workspace_id, kind, name, status)
     values ($1, 'simulador', 'Simulador', 'connected') returning id`,
    [ws],
  );
  const contacto = await pool.query<{ id: string }>(
    `insert into public.contacts (workspace_id, external_id, name)
     values ($1, 'prueba:1', 'Persona de prueba') returning id`,
    [ws],
  );
  const conversacion = await pool.query<{ id: string }>(
    `insert into public.conversations (workspace_id, contact_id, channel_id, status, handover_state)
     values ($1, $2, $3, 'open', 'bot') returning id`,
    [ws, contacto.rows[0]!.id, canal.rows[0]!.id],
  );
  return conversacion.rows[0]!.id;
}
