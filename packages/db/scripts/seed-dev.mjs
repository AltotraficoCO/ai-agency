#!/usr/bin/env node
/**
 * Semilla de desarrollo.
 *
 * Crea un espacio de trabajo de ejemplo con un agente conversacional PUBLICADO
 * y listo para conversar en el simulador. Es idempotente: se puede ejecutar
 * tantas veces como haga falta.
 *
 *   DATABASE_URL=postgresql://... node scripts/seed-dev.mjs
 *
 * El usuario se inserta en `auth.users`, que es lo que dispara el alta completa
 * (organizacion, espacio, perfil, membresia de propietario, equipo por defecto,
 * cartera de créditos y suscripcion de prueba). Sembrar las tablas a mano
 * saltandose ese disparador daria un espacio a medias que no se parece en nada
 * al de un cliente real.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CORREO = process.env.STRAPPY_USUARIO_DEV ?? 'demo@strappy.test';
const EMPRESA = 'Panadería La Espiga';

const ESPECIFICACION = {
  identidad: {
    nombre: 'Espiga',
    idioma: 'español',
    tono: 'cercano y breve, tutea, sin tecnicismos',
    proposito: 'atender a quien escribe por WhatsApp y no dejar a nadie sin respuesta',
  },
  objetivo: 'tomar el pedido o dejar agendada la visita a la tienda',
  hace: [
    'Responde dudas sobre productos, precios y horarios con la información del negocio.',
    'Toma pedidos sencillos y confirma la hora de recogida.',
    'Avisa cuando algo está agotado y propone una alternativa.',
  ],
  noHace: [
    'No inventa precios ni promociones que no estén confirmadas.',
    'No promete entregas a domicilio: la panadería solo entrega en tienda.',
    'No pide datos de tarjeta ni de pago por chat.',
  ],
  recoger: [
    { clave: 'nombre', etiqueta: 'nombre de la persona', obligatorio: true },
    { clave: 'telefono', etiqueta: 'teléfono de contacto', pista: 'solo si escribe desde otro canal' },
    { clave: 'hora_recogida', etiqueta: 'hora a la que pasa a recoger' },
  ],
  escalar: [
    'Cuando la persona se queje de un pedido ya entregado.',
    'Cuando pida una factura o algo administrativo.',
    'Cuando lo pida expresamente.',
  ],
};

const { Client } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(2);
}

const db = new Client({ connectionString: url });
await db.connect();

try {
  await db.query('begin');

  // 1 · Usuario. El disparador on_auth_user_created hace todo lo demas.
  let { rows } = await db.query('select id from auth.users where email = $1', [CORREO]);
  let userId = rows[0]?.id;
  if (!userId) {
    userId = randomUUID();
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, $2, jsonb_build_object('full_name', $3::text, 'organization', $4::text))`,
      [userId, CORREO, 'Ana Restrepo', EMPRESA],
    );
    console.log(`· usuario creado: ${CORREO}`);
  } else {
    console.log(`· usuario existente: ${CORREO}`);
  }

  const espacio = await db.query(
    `select w.id, w.name from public.memberships m
       join public.workspaces w on w.id = m.workspace_id
      where m.user_id = $1 order by m.created_at asc limit 1`,
    [userId],
  );
  const workspaceId = espacio.rows[0]?.id;
  if (!workspaceId) throw new Error('El disparador de alta no creó ningún espacio.');
  console.log(`· espacio: ${espacio.rows[0].name} (${workspaceId})`);

  // 2 · Ficha de empresa: sin esto el agente no sabe donde trabaja.
  await db.query(
    `insert into public.company_profiles
       (workspace_id, legal_name, brand_name, description, industry, website,
        city, country, timezone, currency, business_hours, policies)
     values ($1, $2, $2, $3, 'alimentacion', 'https://laespiga.example',
             'Medellín', 'CO', 'America/Bogota', 'COP',
             $4::jsonb, $5::jsonb)
     on conflict (workspace_id) do update set
       brand_name = excluded.brand_name,
       description = excluded.description,
       business_hours = excluded.business_hours,
       policies = excluded.policies,
       updated_at = now()`,
    [
      workspaceId,
      EMPRESA,
      'Panadería de barrio con horno propio. Pan artesanal, pastelería y café para llevar.',
      JSON.stringify({
        texto: 'De lunes a sábado de 6:00 a 20:00. Domingos de 7:00 a 13:00.',
        lunes: [{ desde: '06:00', hasta: '20:00' }],
        martes: [{ desde: '06:00', hasta: '20:00' }],
        miércoles: [{ desde: '06:00', hasta: '20:00' }],
        jueves: [{ desde: '06:00', hasta: '20:00' }],
        viernes: [{ desde: '06:00', hasta: '20:00' }],
        sabado: [{ desde: '06:00', hasta: '20:00' }],
      }),
      JSON.stringify([
        'Los pedidos especiales se encargan con 24 horas de antelación.',
        'No hay entrega a domicilio: la recogida es siempre en tienda.',
      ]),
    ],
  );

  // 3 · Agente + version publicada.
  const agente = await db.query(
    `with existente as (
       select id from public.agents
        where workspace_id = $1 and name = $2 limit 1
     ), creado as (
       insert into public.agents
         (workspace_id, kind, agent_type, name, description, status, mode, created_by)
       select $1, 'own', 'conversational', $2, $3, 'draft', 'lite', $4
        where not exists (select 1 from existente)
       returning id
     )
     select id from existente union all select id from creado`,
    [
      workspaceId,
      'Espiga, la que atiende',
      'Atiende WhatsApp, resuelve dudas del catálogo y toma pedidos para recoger en tienda.',
      userId,
    ],
  );
  const agentId = agente.rows[0].id;

  // Las versiones son inmutables: si la semilla cambia, se publica una NUEVA,
  // no se reescribe la anterior. Es el mismo camino que sigue un cliente.
  const ultima = await db.query(
    `select id, spec from public.agent_versions
      where workspace_id = $1 and agent_id = $2
      order by version desc limit 1`,
    [workspaceId, agentId],
  );

  const alDia =
    ultima.rows[0] &&
    JSON.stringify(ultima.rows[0].spec) === JSON.stringify(ESPECIFICACION);

  let versionId = alDia ? ultima.rows[0].id : undefined;
  if (!versionId) {
    const version = await db.query(
      `insert into public.agent_versions
         (workspace_id, agent_id, spec, compiled_prompt, prompt_hash, model, changelog, published_by)
       values ($1, $2, $3::jsonb, $4, $5, 'zai/glm-4.7-flash', 'Versión inicial de la semilla', $6)
       returning id`,
      [
        workspaceId,
        agentId,
        JSON.stringify(ESPECIFICACION),
        'compilado en cada turno por @strappy/core',
        'seed',
        userId,
      ],
    );
    versionId = version.rows[0].id;
    console.log('· version publicada');
  }

  await db.query(
    `update public.agents
        set active_version_id = $3, status = 'published', updated_at = now()
      where workspace_id = $1 and id = $2`,
    [workspaceId, agentId, versionId],
  );
  console.log(`· agente: ${agentId} (publicado)`);

  // 4 · Un poco de conocimiento, para que buscar_conocimiento tenga que buscar.
  const cerebro = await db.query(
    `with existente as (
       select id from public.brains where workspace_id = $1 and name = 'Catálogo y horarios' limit 1
     ), creado as (
       insert into public.brains (workspace_id, name, description, status, created_by)
       select $1, 'Catálogo y horarios', 'Lo que la panadería vende y cuándo abre.', 'ready', $2
        where not exists (select 1 from existente)
       returning id
     )
     select id from existente union all select id from creado`,
    [workspaceId, userId],
  );
  const brainId = cerebro.rows[0].id;

  await db.query(
    `insert into public.agent_brains (workspace_id, agent_id, brain_id)
     values ($1, $2, $3) on conflict (agent_id, brain_id) do nothing`,
    [workspaceId, agentId, brainId],
  );

  const documentos = [
    [
      'Catálogo y precios',
      'Pan campesino 6.000 COP la unidad. Baguette 5.000 COP. Croissant de mantequilla 4.500 COP. ' +
        'Torta de zanahoria por porcion 9.000 COP, entera 70.000 COP. Café americano 4.000 COP, capuchino 6.500 COP. ' +
        'Los precios incluyen impuestos y se actualizan el primer lunes de cada mes.',
    ],
    [
      'Horarios y recogida',
      'La tienda abre de lunes a sábado de 6:00 a 20:00 y los domingos de 7:00 a 13:00. ' +
        'Los pedidos se recogen en el mostrador de la entrada. No hay entrega a domicilio. ' +
        'Los pedidos especiales (tortas enteras, bandejas para eventos) se encargan con 24 horas de antelación.',
    ],
    [
      'Alérgenos',
      'Todos los panes contienen gluten. El pan de maíz y las galletas de coco no llevan gluten añadido ' +
        'pero se hornean en el mismo horno, así que no son aptos para celíacos. ' +
        'La torta de zanahoria lleva nueces.',
    ],
  ];

  for (const [titulo, contenido] of documentos) {
    const fuente = await db.query(
      `with existente as (
         select id from public.brain_sources
          where workspace_id = $1 and brain_id = $2 and title = $3 limit 1
       ), creada as (
         insert into public.brain_sources
           (workspace_id, brain_id, kind, title, raw_content, status, chunk_count, indexed_at, created_by)
         select $1, $2, 'text', $3, $4, 'indexed', 1, now(), $5
          where not exists (select 1 from existente)
         returning id
       )
       select id from existente union all select id from creada`,
      [workspaceId, brainId, titulo, contenido, userId],
    );
    const sourceId = fuente.rows[0].id;
    await db.query(
      `insert into public.brain_chunks
         (workspace_id, brain_id, source_id, position, content, token_count, metadata)
       select $1, $2, $3, 0, $4, $5, jsonb_build_object('title', $6::text)
        where not exists (
          select 1 from public.brain_chunks
           where workspace_id = $1 and source_id = $3 and position = 0)`,
      [workspaceId, brainId, sourceId, contenido, Math.ceil(contenido.length / 4), titulo],
    );
  }
  console.log(`· conocimiento: ${documentos.length} documentos`);

  await db.query('commit');

  const saldo = await db.query(
    `select included_balance + purchased_balance - reserved_balance as saldo
       from public.credit_wallets where workspace_id = $1`,
    [workspaceId],
  );

  console.log('');
  console.log('Listo.');
  console.log(`  correo      ${CORREO}`);
  console.log(`  espacio     ${workspaceId}`);
  console.log(`  agente      ${agentId}`);
  console.log(`  créditos    ${saldo.rows[0]?.saldo ?? 0}`);
  console.log('');
  console.log(`  Pruébalo en /agentes/${agentId}/probar`);
} catch (error) {
  await db.query('rollback').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
