# @strappy/worker

Proceso persistente que ejecuta los agentes de tipo `tarea_por_encargo`. Hoy
atiende un consumidor —el del Webmaster de WordPress—; los de WhatsApp entran
como una línea más en la lista de `src/index.ts`.

## Qué hace una vuelta del bucle

1. **Reclama** una tarea con `FOR UPDATE SKIP LOCKED` y se la arrienda por once
   minutos, renovando el arrendamiento cada treinta segundos. Si el proceso
   muere a mitad, otro worker la recoge cuando el arrendamiento expira.
2. **Carga el sitio** desde `public.connections` y **descifra** las credenciales
   con `APP_ENCRYPTION_KEY`. A partir de ahí viven solo en el contexto que se
   inyecta a las herramientas: nunca entran al prompt.
3. **Ejecuta** el bucle de herramientas de `@strappy/webmaster` con un tope de
   25 acciones y nueve minutos.
4. **Escribe el desenlace**: resumen legible, lista de acciones con su duración,
   capturas de verificación, identificadores de backup y créditos consumidos.

## Estados de una tarea

| Estado | Qué significa |
| --- | --- |
| `queued` | esperando a que un worker la reclame |
| `running` | en curso, con arrendamiento vivo |
| `esperando_aprobacion` | el agente propuso algo sensible y no lo ejecutó; la conversación queda guardada para reanudar tras el clic |
| `done` | terminada, con evidencia |
| `failed` | agotó los intentos, o falló por algo que no tiene sentido reintentar |

Un fallo de credenciales o de configuración **no se reintenta**: reintentar algo
que va a fallar igual gasta los créditos del cliente tres veces.

## Configuración

Todo por entorno; el proceso se niega a arrancar si falta algo.

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | sí | cola y adaptadores |
| `APP_ENCRYPTION_KEY` | sí | descifra las credenciales de los sitios; la misma que usa la web |
| `OPENROUTER_API_KEY` | sí | clave de la cartera de modelos (o `AI_GATEWAY_API_KEY` con `MODEL_WALLET=vercel-gateway`) |
| `WORKER_ID` | no | identifica al worker en el arrendamiento |
| `WORKER_POLL_MS` | no | cada cuánto consulta la cola cuando está vacía |
| `WORKER_CHROME_PATH` | no | Chrome para la verificación visual |
| `WORKER_REFERENCIAS_HOST` | no | host del almacén de referencias del cliente |
| `WORKER_TABLA_TAREAS` | no | nombre de la tabla de la cola |

**El modelo no se configura.** Cada tarea usa el de su espacio: el modo del
agente (`lite` o `max`), rebajado a `lite` si el plan no incluye Max, y la fila
`builder` de `model_tiers`. Las tarifas salen de `credit_rates` y lo gastado se
descuenta del mismo libro de créditos que el resto de Strappy. Ver
`src/adaptadores/motor.ts`.

`playwright-core` con un Chrome es opcional: sin él la tarea se hace igual y se
avisa de que la verificación visual no estuvo disponible.

## Esquema

Las tablas `agent_tasks`, `site_backups` y `task_approvals` están en
`packages/db/migrations/0015_tareas_webmaster.sql`. Los únicos ficheros de este
worker que conocen el esquema son `src/queue/postgres.ts`,
`src/adaptadores/postgres.ts` y `src/adaptadores/motor.ts`.

El sitio no necesita tabla nueva: se guarda en `public.connections`, con el
sobre cifrado en `credentials_encrypted` y `{"url", "tipo", "agent_name",
"primer_contacto"}` en `metadata`.

## Probarlo contra un WordPress de verdad

Los tests corren contra un doble de la REST API. Un doble no prueba que el
WordPress del cliente tenga la REST API abierta, las contraseñas de aplicación
activas o un proxy que no se coma la cabecera `Authorization`. Para eso:

```bash
export WP_URL=https://misitio.com
export WP_USER=admin
export WP_APP_PASSWORD='abcd EFGH ijkl MNOP qrst UVWX'

# Solo lee, no gasta tokens: dice si el agente podría trabajar ahí.
pnpm probar-sitio salud

# Corre el agente en modo simulación: explora y propone, no muta nada.
pnpm probar-sitio plan "cambia el título de la página de contacto a «Hablemos»"

# Ejecuta de verdad. Empieza siempre por `plan`.
pnpm probar-sitio ejecutar "…"
```

`plan` y `ejecutar` necesitan una clave de modelo en el entorno.

Con Docker instalado, `docker-compose.wordpress.yml` levanta un WordPress local
contra el que probar sin arriesgar el sitio de nadie. Ese archivo **no se ha
ejecutado nunca**: en la máquina donde se escribió no había Docker.
