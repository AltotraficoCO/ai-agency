# @strappy/webmaster

El Webmaster: el primer agente contratable del catálogo. Trabaja para la
empresa, no para sus clientes. El dueño le pide por chat «actualiza los precios
de la página de planes» y lo hace de verdad sobre su WordPress, con evidencia de
lo que hizo y con la posibilidad de revertirlo.

Es de tipo `tarea_por_encargo`: dura minutos, tiene un tope de 25 acciones y
nueve minutos, y sus acciones sensibles exigen un clic humano.

## Qué hay aquí

| Fichero | Qué es |
| --- | --- |
| `src/tools/` | las 39 herramientas, definidas **una sola vez** con `defineTool` |
| `src/agent.ts` | la ficha del agente y sus prompts |
| `src/loop.ts` | el bucle de herramientas sobre AI SDK v6 |
| `src/wordpress/` | cliente de la REST API y constructor de secciones Elementor |
| `src/conector/` | cliente del contrato estándar para sitios propios |
| `src/aprobacion.ts` | qué es sensible, la huella de una acción y los backups |
| `src/ports.ts` | todo lo que el runtime debe inyectar |
| `src/testing/` | el doble de la REST API de WordPress y los dobles de puertos |

## Las 39 herramientas

21 `wp_*`, 10 `conector_*`, 5 `navegador_*`, más `sitio_salud`,
`verificar_http` y `ver_referencia`. Vienen del proyecto anterior, donde ya
funcionan en producción; los handlers están portados, no reinventados.

Lo que cambia es dónde viven. En el original la misma herramienta estaba escrita
**dos veces** —una en `executor.ts` y otra en `mcp/server.ts`, 625 y 1342
líneas— y las dos copias divergieron. Aquí hay una definición y dos
adaptadores, los de `@strappy/tools`: uno al AI SDK y otro a servidor MCP. Si
hay que tocar una herramienta, hay exactamente un sitio donde tocarla.

## Las cuatro reglas que hacen que se pueda vender

**1 · Se mide lo que gasta.** El original arrancaba OpenCode headless por tarea:
un binario de unos 100 MB, entre dos y cinco segundos de arranque y ningún dato
de consumo. Un agente cuyo gasto no se puede medir no cabe en un sistema de
créditos. Aquí el bucle es propio, sobre AI SDK v6, que da `usage` por paso.

**2 · Backup antes de cada mutación.** Toda herramienta que escribe lee primero
el estado actual, lo guarda y devuelve `backup_id`. Revertir es un botón:
`wp_restaurar_contenido` con ese identificador deja el contenido exactamente
como estaba.

**3 · Aprobación humana de verdad.** Hay dos caminos, porque hay dos clases de
acción sensible:

- Las que lo son **siempre** —instalar, activar o borrar plugins, crear usuarios
  o cambiar roles— se marcan `sensitive` en la definición y el AI SDK las corta
  antes de ejecutarlas.
- Las que lo son **según la entrada** —la portada, los precios, el checkout— no
  las puede decidir un esquema: es la misma herramienta con otros argumentos. Se
  deciden dentro de `execute`, mirando la entrada y el estado del sitio. La
  herramienta no ejecuta: registra una solicitud y devuelve su identificador.

En ambos casos la tarea queda suspendida con la conversación guardada, y al
reanudar continúa desde donde estaba en vez de volver a pagar la exploración.
Una aprobación vale para **exactamente** la acción aprobada: la huella es un
hash de la herramienta y sus argumentos, así que cambiar un carácter exige otro
clic.

**4 · Simulación en el primer contacto.** La primera vez que el Webmaster toca
un sitio, explora de verdad y **propone el plan sin mutar nada**: las
herramientas de lectura funcionan, las de escritura devuelven `simulado`. El
primer contacto con el sitio de un cliente no puede ser también el primer
destrozo.

## Verificación

Un HTTP 200 no dice que la página se vea bien. El agente verifica con un
navegador real, sesión persistente durante toda la tarea, contenida en el
dominio del cliente: abre la página, lee el texto renderizado, prueba los
enlaces y mira los errores de JavaScript. Las capturas van a la evidencia de la
tarea.

## Qué inyecta el runtime

Nada de esto lo elige el modelo. `SitioContext` lleva las credenciales ya
descifradas, los puertos de backups y aprobaciones, el navegador y la salida
HTTP. El registro de `@strappy/tools` rechaza al arrancar cualquier herramienta
que declare `workspaceId` o `token` como parámetro del modelo.

## Probarlo

```bash
pnpm --filter @strappy/webmaster test
```

Corren contra `src/testing/wordpress.ts`, un doble de la REST API con estado en
memoria que responde en las mismas rutas y con las mismas formas. Para probar
contra un WordPress real, `apps/worker/scripts/probar-sitio.ts`.
