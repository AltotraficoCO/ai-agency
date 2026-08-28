# @strappy/db

Esquema, tipos y helpers de tenencia de Strappy. **Sin ORM**: SQL a mano.
Postgres de Supabase con Auth, RLS, Realtime, pgvector y particionado por mes.

El esquema esta en **ingles**; los comentarios, la interfaz y estos documentos,
en **espanol**.

---

## Que hay aqui

```
migrations/        Fuente de verdad del esquema. Se aplican en orden.
src/types.ts       Tipos TypeScript del esquema, escritos a mano.
src/client.ts      Cliente sin dependencias + helpers de tenant.
tests/isolation.sql  Criterio de aceptacion del aislamiento multi-tenant.
tests/harness/     Simulacion local de Supabase (auth, roles, pgvector).
scripts/           apply.sh · test-isolation.sh · validate-local.sh
```

`supabase/migrations` en la raiz del repositorio es un enlace simbolico a
`packages/db/migrations`: los ficheros no se duplican.

### Las diez migraciones

| Fichero | Contenido |
|---|---|
| `0001_core.sql` | organizaciones, espacios, perfiles, membresias, invitaciones, equipos, bitacora. `is_member`, `has_perm`, `assert_workspace`, rol `strappy_worker`, alta de usuario. |
| `0002_channels.sql` | canales (tipo como texto libre), cuentas y numeros de WhatsApp, **`channel_routing`**. |
| `0003_agents.sql` | ficha de empresa, agentes, versiones **inmutables**, borradores del meta-agente, variables, herramientas, cerebros, catalogo y contrataciones. |
| `0004_conversations.sql` | contactos, conversaciones, mensajes, acuses, adjuntos, eventos, notas, etiquetas, respuestas rapidas. Publicacion en Realtime. |
| `0005_ingest.sql` | `webhook_events` particionada por mes, ingesta idempotente, retencion de 30 dias. |
| `0006_knowledge.sql` | cerebros, fuentes, fragmentos con `vector(1536)`, HNSW + GIN espanol, `search_knowledge` con RRF. |
| `0007_tools.sql` | herramientas (globales y propias), conexiones cifradas, `agent_runs` y `tool_runs`. |
| `0008_billing.sql` | suscripciones, carteras, `credit_ledger` particionado, tarifario versionado, modelos por modo, **`charge_credits`**. |
| `0009_analysis.sql` | analisis de conversacion, automatizaciones, evaluacion y extraccion. |
| `0010_seed.sql` | catalogo de agentes, tarifas iniciales, `model_tiers`, herramientas de sistema. |

Todas son idempotentes: reaplicar la serie completa no rompe nada.

---

## Aplicar las migraciones

### Con la CLI de Supabase (recomendado en local)

```bash
supabase start          # levanta Postgres 17 con pgvector y auth
supabase db reset       # crea la base y aplica supabase/migrations en orden
```

`supabase db reset` recorre el enlace simbolico y aplica `0001` … `0010`.

### Con psql (cualquier base, incluida la de produccion)

```bash
pnpm --filter @strappy/db db:apply "postgresql://postgres:postgres@localhost:54322/postgres"
# o
DATABASE_URL=... packages/db/scripts/apply.sh
```

En una base nueva de Supabase basta con esto: las extensiones (`pgcrypto`,
`pg_trgm`, `vector`) se crean desde las propias migraciones.

### Tareas periodicas

Dos funciones hay que llamar desde un cron (o desde el arranque del worker):

```sql
select public.ensure_month_partitions(2);          -- crea particiones del mes que viene
select public.drop_expired_webhook_partitions(30); -- retencion de webhook_events
```

Si no se llaman, las inserciones del mes siguiente fallaran por falta de
particion. `ensure_month_partitions` es idempotente y barata: llamarla a diario.

---

## Correr el test de aislamiento

Es el **criterio de aceptacion**: si falla, la fase esta bloqueada. Crea dos
espacios de trabajo con datos en las 47 tablas de negocio y comprueba que
ninguno ve ni toca nada del otro. Termina en `ROLLBACK`, asi que no deja rastro
y se puede lanzar contra una base con datos.

```bash
pnpm --filter @strappy/db db:test "postgresql://postgres:postgres@localhost:54322/postgres"
```

Hay que ejecutarlo con un rol **superusuario o propietario del esquema**, porque
necesita hacer `SET ROLE` a `authenticated` y a `strappy_worker`.

Lo que comprueba, en orden:

1. **Cobertura** · ninguna tabla con `workspace_id` sin RLS y sin politicas.
   Se calcula del catalogo de Postgres, no de una lista escrita a mano, asi que
   una tabla nueva queda cubierta el dia que se crea.
2. Dos espacios completos sembrados por el trigger de alta.
3. El usuario de A no ve **ni una fila** de B, en ninguna tabla. Ademas se
   verifica que el test no pasa en vacio (tiene que ver sus propios datos).
4. Lo mismo desde B.
5. Escritura cruzada bloqueada (insert y update contra el otro espacio).
6. El worker: sin `app.workspace_id` no ve nada; con el, solo ese espacio.
   `assert_workspace` corta el cruce aunque la RLS fallara.
7. Presets de rol, override aditivo (`"contacts.write"`), revocacion
   (`"!agents.write"`) y suspension de membresia.
8. `agent_versions` es inmutable.
9. `charge_credits`: tarifa correcta, orden incluido→comprado, reintento que no
   cobra dos veces, falta de saldo que devuelve `no_credits`.
10. `channel_routing` e ingesta idempotente de webhooks.

Salida esperada al final:

```
NOTICE:  ================================================
NOTICE:    AISLAMIENTO MULTI-TENANT: TODAS LAS PRUEBAS OK
NOTICE:  ================================================
```

### Validacion sin Docker

Si no hay Supabase ni Docker pero si un Postgres local, `validate-local.sh`
aplica las diez migraciones sobre una base desechable simulando `auth`, los
roles de Supabase y pgvector:

```bash
packages/db/scripts/validate-local.sh strappy_check
psql -v ON_ERROR_STOP=1 -f packages/db/tests/isolation.sql strappy_check
```

Comprueba sintaxis y coherencia, no rendimiento vectorial (el HNSW se sustituye
por un btree y el operador `<=>` es un simulacro).

---

## Como funciona el aislamiento

### Lectura: `is_member`, escritura: `has_perm`

```sql
create policy tabla_read  on public.tabla for select to authenticated
  using (public.is_member(workspace_id));
create policy tabla_write on public.tabla for all to authenticated
  using (public.has_perm(workspace_id, 'inbox.write'))
  with check (public.has_perm(workspace_id, 'inbox.write'));
```

Ambas son `security definer` con `search_path` fijado. El patron no se escribe a
mano en cada tabla: lo genera `public.apply_tenant_rls(tabla, permiso, solo_lectura, filas_globales)`,
porque aplicarlo a mano en 47 tablas garantiza que antes o despues se olvide una,
y una tabla sin RLS es una fuga entre clientes.

Tablas de **solo lectura** para el usuario (las escribe el rol de servicio):
`audit_log`, `webhook_events`, `credit_ledger`, `agent_runs`, `tool_runs`,
`conversation_events`, `message_status_events`, `channel_routing`,
`subscriptions`, `credit_wallets`, `usage_daily`, `waba_analytics_daily`,
`conversation_analysis`, `automation_runs`, `extractions`.

### Permisos

`role` es un preset y `permissions text[]` el override.

| preset | alcance |
|---|---|
| `owner` | todo (`*`) |
| `admin` | todo salvo `billing.manage` y `workspace.delete` |
| `builder` | agentes, conocimiento, herramientas, canales + `inbox.read` |
| `agent` | bandeja y contactos |
| `analyst` | solo lectura |

El override es aditivo (`"contacts.write"`) o revocatorio (`"!agents.write"`);
**la revocacion siempre gana** sobre el preset.

### El worker no usa el rol de servicio

`service_role` hace `BYPASSRLS`: con el, un `join` mal escrito devuelve datos de
otro cliente y nada lo impide. Por eso el worker se conecta como
**`strappy_worker`**, un rol sujeto a RLS cuyas politicas son
`workspace_id = public.current_workspace()`, es decir, el valor declarado con
`SET LOCAL app.workspace_id`. Sin declararlo no ve absolutamente nada.

```ts
import { createWorkerClient, chargeCredits } from '@strappy/db';

const db = createWorkerClient(pool);           // pool conectado como strappy_worker

await db.withWorkspace(workspaceId, async (scope) => {
  // aqui dentro la RLS solo deja ver este espacio
  const { rows } = await scope.query('select * from conversations where pending_run_at < now()');
  await chargeCredits(scope, {
    idempotencyKey: `agent_run:${runId}`,
    items: [
      { kind: 'model_input',  ref_key: 'zai/glm-4.7-flash', quantity: 10 },
      { kind: 'model_output', ref_key: 'zai/glm-4.7-flash', quantity: 2 },
    ],
  });
});
```

Y las funciones criticas revalidan por su cuenta con `assert_workspace()`, que
aborta si el `workspace_id` del argumento no coincide con el declarado. Es una
barrera **independiente de la RLS**: sigue funcionando aunque una politica este
mal escrita.

### Regla de indices

Toda tabla de negocio lleva `workspace_id` y **todo indice compuesto empieza por
el**. Es lo que hace que la RLS sea gratis: el filtro del tenant y el del indice
son el mismo prefijo.

---

## Decisiones que conviene conocer

- **`channel_routing`** es una tabla plana mantenida por trigger que mapea
  `phone_number_id → (workspace_id, channel_id, agent_id)`. El webhook resuelve
  el tenant con **una lectura por clave primaria** en lugar de un join de tres
  tablas por evento.
- **`messages.external_id`** con `unique(workspace_id, external_id)` es la
  barrera de idempotencia real: Meta reenvia el mismo webhook varias veces. El
  unico es **por espacio**, no global; si fuese global, dos clientes no podrian
  recibir eventos con identificadores que colisionen.
- **`agent_versions` es inmutable.** Publicar es crear una version nueva y mover
  el puntero `agents.active_version_id`. Un trigger impide reescribirla o
  borrarla. Sin esto no se puede auditar con que prompt se respondio una
  conversacion del mes pasado.
- **La ventana de 24 h de WhatsApp no existe en el esquema.** Se guarda como
  `conversations.send_restriction_until`, generica, porque el motor no debe
  conocer conceptos de un canal concreto.
- **Particionado por mes** en `webhook_events` (por `received_at`) y
  `credit_ledger` (por `created_at`). Los indices unicos de deduplicacion e
  idempotencia son **locales a cada particion**: Postgres obligaria a incluir la
  columna de particion en una clave global, y esa columna cambia en cada
  reintento, lo que anularia justamente la deduplicacion. Por eso las funciones
  usan `ON CONFLICT DO NOTHING` sin objetivo.
- **`credit_rates` es versionada.** Una fila vigente no se edita: se cierra con
  `effective_to` y se inserta otra. Un trigger lo impone. Editar un precio
  reescribiria el coste historico y descuadraria las facturas ya emitidas.
- **Busqueda hibrida.** `search_knowledge` fusiona la lista vectorial (HNSW
  coseno) y la lexica (`to_tsvector('spanish', ...)`) con reciprocal rank fusion.
  Se fusiona por posicion y no por puntuacion, de modo que no hay que normalizar
  la distancia coseno contra `ts_rank`, que viven en escalas incomparables. En
  espanol el componente lexico sube mucho la precision con referencias de
  producto y precios.
- **1 credito = 0,001 USD de precio de venta**, con **margen 3,0x** sobre el
  coste del modelo: `creditos_por_ktoken = usd_por_millon_de_tokens x 3`. La
  formula y su justificacion estan comentadas en `0008_billing.sql` y aplicadas
  en `0010_seed.sql`.

---

## Al cambiar el esquema

1. Anadir una migracion nueva (`0011_...sql`). **Nunca** editar una ya aplicada.
2. Cerrar toda tabla de negocio con `select public.apply_tenant_rls(...)`.
3. Comentar la tabla con `COMMENT ON` en espanol explicando su papel.
4. Actualizar `src/types.ts` a mano (se mantiene en paralelo a proposito: el
   generador no produce uniones literales alineadas con los `CHECK`).
5. Correr `pnpm --filter @strappy/db typecheck` y el test de aislamiento.
