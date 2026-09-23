# Estado y pendientes

Última actualización: 22 de septiembre de 2026, por la tarde.
Todo lo que dice «hecho» está **en producción**: subido y desplegado en Vercel
y en el worker del VPS, que desde hoy se despliega solo.

- Último commit desplegado: `7f8dc5b` (web y worker)
- Migraciones aplicadas en producción: **hasta la 0039**, y desde hoy las aplica
  el flujo de despliegue del worker en cada commit
- Worker del VPS: en pie y estable, desplegado por GitHub Actions

---

## Lo que se hizo

### El negocio

- **Margen del 20%** sobre lo que cobra OpenRouter, en vez del 3,0x anterior
  (migración 0025). El crédito sigue valiendo 0,001 USD, así que la misma tarea
  consume 2,5 veces menos créditos.
- **Sin descuentos por volumen**: Pro 100, Scale-Up 500, Prime 1.500, y las
  recargas al valor nominal.
- **Fuera de la interfaz** la equivalencia «1.000 créditos = 1 USD».
- **Modelos por tarea**, decididos en base de datos y nunca en el código:
  - WhatsApp, clasificar, extraer, resumir y títulos → GLM-4.7-flash
  - Strap construyendo → DeepSeek V4 Flash
  - Agentes del negocio → DeepSeek V4 Flash (Claude Sonnet 5 de respaldo)
  - Modo Max → Claude Sonnet 5, y Opus 5 al construir
  - Conocimiento → text-embedding-3-small

### La empresa por departamentos

Menú y pantalla de contratar organizados como una plantilla:
**Comunicaciones, Marketing, Creativo, Desarrollo y Financiero**.
«Tu equipo» e «Impacto» van arriba porque miran a toda la empresa.

Tema **claro por defecto**, con el verde de marca bajado de tono sobre blanco.

### El catálogo: seis puestos

| Departamento | Agentes |
|---|---|
| Desarrollo | Webmaster, Velocista |
| Creativo | Diseñador |
| Marketing | Marketing |
| Financiero | Administrativo, Reportes |

- **Webmaster**: diseña con los colores reales del sitio, escribe artículos
  completos con extracto e imagen destacada, no crea tres entradas cuando le
  pides una, no pisa contenido al reescribir y no se queda en bucle. Vigila el
  sitio cada 15 minutos y avisa solo cuando algo cambia de verdad.
- **Velocista**: mide con PageSpeed (móvil y escritorio), explica en dinero y en
  cristiano, y arregla lo que puede con aprobación y copia previa.
- **Diseñador**: dibuja con la identidad del sitio. El Webmaster ya le pide la
  portada del artículo: dos agentes en un mismo encargo y un solo cargo.
- **Administrativo** y **Reportes**: Alegra. Cartera, facturas, pagos,
  recordatorios y el informe del negocio en una página.

### Lo que sostiene todo eso

- **El worker ejecuta cualquier agente**, no solo el Webmaster (migración 0029).
- **Trabajo programado**: cada mañana, cada lunes, con zona horaria del cliente
  (migración 0034). El programador **crea encargos**, no ejecuta agentes: así
  hereda aprobaciones, registro en vivo, cobro y reintentos.
- **Los agentes se piden ayuda entre ellos**, solo a quien esté contratado, con
  los permisos de cada uno y sin cadenas infinitas.
- **Se puede despedir a un agente**, algo que no existía.
- **Avisos por WhatsApp** del Webmaster: construidos, con su pantalla de ajustes.

### Arreglos que destaparon un patrón

Cuatro fallos del mismo tipo, encontrados por el cliente al usar el producto:

1. **Bullets** de los agentes nuevos, vacíos.
2. **Identidad** vacía al abrir Instrucciones.
3. **«Personaliza»** sin preguntas, y lo respondido **no lo leía nadie**.
4. **La foto** de un agente contratado no se podía cambiar desde su pantalla.

En los cuatro casos la causa era la misma: **información escrita a mano en
diccionarios del código, indexados por agente**, o funcionalidad montada solo en
una pantalla. Servía con dos agentes; con seis, cada agente nuevo nacía
incompleto y nadie se enteraba hasta que alguien lo abría.

Los arreglos van todos en la misma dirección: que el dato salga de la ficha del
agente y que, cuando falte, haya un respaldo digno en vez de un hueco en blanco.

- **«Mejorar con IA»**, que solo enseñaba un aviso, ya funciona: propone sección
  por sección, no se aplica sin aceptar, se puede deshacer y cuesta 1 crédito.
  El modelo **no puede** cambiar el nombre del agente ni las claves de los datos
  a recoger: esos campos no existen en lo que devuelve.

---

### Refactor (12-sep, tarde)

Dos refactors **sin cambio de comportamiento**, en commits separados, con los
937 tests en verde y ninguno editado.

- **El esqueleto del agente estaba copiado seis veces.** Los cinco `loop.ts` y
  las cinco ramas del worker se colapsaron en `packages/agentes/src/montaje.ts`.
  Añadir un agente al worker pasa de **85 líneas a 35**.
  - El bloque de compañeros se añade ahora en el armazón: olvidarlo en un oficio
    nuevo no daba error, solo un agente que creía trabajar solo.
  - Los siete parámetros posicionales del worker (varios del mismo tipo, se
    podían intercambiar sin que el compilador dijera nada) pasaron a un objeto.
- **El contenido de producto salió de `catalogo.ts`** (825 → 393 líneas) a
  `catalogo-contenido.ts`, un bloque por agente. Añadir el séptimo es añadir un
  bloque, no acordarse de editar tres diccionarios. Contenido idéntico,
  comprobado texto por texto.
- **No se tocaron** `wp.ts` (1.407), el cliente de WordPress (1.128) ni los tipos
  de la base (1.101): grandes pero coherentes y sin duplicación. Partirlos ahora
  sería riesgo sin ganancia.

### 22 de septiembre: Google Ads de punta a punta, y el worker se despliega solo

**Google Ads funciona**: un cliente pulsa «Conectar Google Ads», acepta en
Google y Strappy lista sus cuentas. Para llegar ahí hubo que estrenar el
adaptador contra la API real, y salieron cinco cosas seguidas:

1. **Google retiró los developer tokens el 9-sep-2026.** El nivel de acceso lo
   tiene ahora el proyecto de Google Cloud dueño del cliente OAuth. Fuera la
   variable, fuera la cabecera. El proyecto «Strappy» tiene nivel
   **Explorador** (cuentas reales, 2.880 operaciones/día); **Básico** exige
   la verificación de marca.
2. **La v21 de la API ya no existe**: 404 en HTML. Se usa la **v25**, la última
   publicada (la v26 acepta la ruta pero no tiene métodos). Todo el adaptador
   está verificado contra el esquema oficial de la v25.
3. **`pageSize` en la búsqueda** devuelve `PAGE_SIZE_NOT_SUPPORTED` desde la
   v17. Fuera.
4. **El origen de la URL de retorno** salía de `request.url`, que en Vercel es
   el host interno: `redirect_uri_mismatch`. Sale de `x-forwarded-host`.
5. **Los errores de Google se recortaban** antes de llegar a la causa. Ahora se
   enseña `details[].errors[]` con su código.

Y tres fallos del **mismo patrón de siempre** (diccionarios escritos a mano):
la conexión no contaba como «lista» en Contratar, la pantalla de encargos de
Marketing decía «sin plataformas», y el worker se tragaba en silencio una
conexión que no podía descifrar. Los tres corregidos de raíz.

**Configuración hecha hoy** (con la cuenta victor.sandoval@altotrafico.co):

- Google Cloud: cliente OAuth «Strappy Google Ads» con retorno en strappy.io,
  www.strappy.io, strappy.vercel.app y localhost. Claves en Vercel.
- Cuenta de administrador de Google Ads «Strappy» (706-188-9364).
- Supabase: Site URL `https://www.strappy.io` y redirecciones permitidas.
  Antes iniciar sesión devolvía a strappy.vercel.app.
- `strappy.vercel.app` redirige a `www.strappy.io` en producción.
- Páginas legales públicas: strappy.io/policy y strappy.io/terms.
- **«Continuar con Google» lo pide la app de Strappy**: Google dice «Ir a
  strappy.io» y no el dominio de Supabase. Strappy hace el OAuth con su cliente
  y Supabase crea la sesión con el `id_token` (`signInWithIdToken`, con nonce).
  Probado en producción. Ahorra el dominio de Supabase (35 USD/mes). El cliente
  de Google Ads está autorizado en el proveedor Google de Supabase.
- Ajustes → Canales: **Desconectar** una plataforma de anuncios y **Eliminar**
  un número de WhatsApp (conservando conversaciones).
- **Clave de PageSpeed** creada en el proyecto de Google Cloud (restringida a
  esa API) y puesta en el VPS: el Velocista ya puede medir.
- **El Velocista y Reportes ya son agentes por encargo en la web** (sexto
  fallo del patrón «lista escrita a mano»: la web los trataba como agentes de
  conversación y los contestaba el chat sin herramientas). Cada oficio tiene
  ahora sus textos y su «lo conectado» en la pantalla de encargos.
- **El trabajo programado** vive en un panel lateral desde la cabecera del
  agente, no bajo el chat. Las respuestas de los encargos se pintan con
  formato (negritas, listas), no con asteriscos.
- **Velocista probado contra PageSpeed real**: primera medición real (portada
  de vox.altotrafico-reseller.com, 10,7 s en celular, 10 imágenes pesadas).
  Su guion: informe primero; si hay que decidir, la decisión son botones.
- **Colaboración visible entre agentes**: cada paso lleva quién lo dio, el
  compañero entra a la conversación con su cara y su nombre, no puede
  preguntar al cliente (le responde a quien lo llamó) y, si necesita una
  aprobación, su trabajo pasa a un encargo propio en su bandeja. Probado con
  Velocista → Webmaster (conversión a WebP).
- **«Continuar con Google» lo pide la app de Strappy**, no Supabase.
- **Verificación de la app en Google enviada** con vídeo del flujo real
  (capturas de www.strappy.io con atencion@altotrafico.co, locución de
  ElevenLabs, voz Matilda). Las fuentes están en `.playwright-mcp/video/`
  (fuera del repo).

**Producto**:

- «Conectar» una plataforma de anuncios desde el asistente de contratación
  abre el consentimiento y **vuelve al mismo paso** con el resultado.
- Un agente contratado **se llama como su puesto**: ni al contratar ni en
  Instrucciones se cambia el nombre. La cara, sí.

**El worker se despliega solo** (`.github/workflows/desplegar-worker.yml`):
cada commit en main que toque el worker o los paquetes aplica las migraciones
por el pooler de Supabase (GitHub no tiene IPv6) y entra al VPS por SSH con
una clave restringida a `apps/worker/scripts/desplegar.sh`, que trae main,
instala, reinicia y **falla si el worker no arranca estable**. Antes era a
mano, y así estuvo diez días desincronizado de la web sin que nadie lo viera.

## Pendiente, y depende de ti

Por urgencia:

| Qué | Quién | Plazo / nota |
|---|---|---|
| **Verificación de la app en Google** | Google | **enviada el 22-sep** con el vídeo https://youtu.be/LW8hYX47nJw (no listado). Primer correo en 3-5 días, revisión de 4-6 semanas. Al aprobarse: fuera el aviso de «app no verificada» y se puede pedir el nivel Básico de la API |
| **Razón social y NIT** en la política de privacidad | Victor | el correo `hola@strappy.io` ya está confirmado; Victor pasa la razón social y el NIT más adelante |
| Permiso de **Meta** para publicar por clientes | Victor | 2 a 4 semanas de revisión. Para anuncios hacen falta además `ads_read` y `ads_management` en la misma app |
| App de **TikTok for Business** | Victor | permisos de Ads Management; va en `TIKTOK_APP_ID` y `TIKTOK_APP_SECRET` |
| **Token de Alegra** (usuario propio para Strappy, no la contraseña) | Pedro | sin él, Administrativo y Reportes no tienen dónde mirar |
| **Plantilla de WhatsApp en Meta** (categoría utilidad) | Victor | sin ella no se envía ningún aviso |
| **Precios nuevos en Stripe** | Victor | la web ya dice 100, 500 y 1.500; el cobro sigue en los precios viejos |
| **OpenRouter a cuenta de empresa** con recarga automática | Victor | hoy es una cuenta personal, con tope de 5 USD |
| **Cuatro definiciones del puesto administrativo** | Pedro | desde cuántos días perseguir, si emite o solo prepara, qué impuesto, en qué cuenta |
| **Cuatro personajes propios** | decisión | Diseñador, Velocista, Administrativo y Reportes llevan caras prestadas. Unos 1.300 pesos si se los encarga al Diseñador |

---

## El modelo de los agentes: Lite y Max (22-sep, noche)

**Max estaba roto y nadie lo sabía.** La 0024 pasó los agentes a DeepSeek V4
Flash por coste, pero su `where task = 'negocio'` alcanzó a las DOS filas, la
de `lite` y la de `max`: encender Max cambiaba el modo y no el modelo. La 0043
lo arregla. Hoy:

- **Lite**: DeepSeek V4 Flash, con Sonnet 5 y GLM-4.7-flash de respaldo.
- **Max**: Claude Sonnet 5, con DeepSeek de respaldo.

**Max está en TODOS los planes de pago** (no solo Scale-Up y Prime) y lo
enciende el cliente agente por agente, con el mismo selector que Strap, en
Inicio, en la pantalla de encargos y en la ficha. El gratuito no lo tiene.

**Primera comparación real (22-sep)**: con DeepSeek, el Webmaster se pasó de
alcance (rehizo la portada entera cuando se le pidió el banner), recicló una
foto de la biblioteca en vez de pedirle la portada al Diseñador y delegó «toma
el relevo» sin tarea concreta. Con **Sonnet razonó mucho mejor y restauró la
copia a la primera**. Falta el dato de coste: comparar créditos por encargo
equivalente antes de decidir el modo por defecto. Sonnet cuesta ~15x por
token, así que solo sale a cuenta si evita reintentos.

## Decisión del 22-sep: un agente por oficio

Un agente llama a otro solo cuando el trabajo es de **otro oficio** (otra
herramienta u otra conexión): Webmaster → Diseñador para imágenes, Marketing →
Webmaster para una página de aterrizaje, Reportes → Administrativo para
cobrar. Una tarea del mismo oficio con las mismas herramientas es una
**capacidad**, no un agente. Por eso **el Velocista se fusiona en el
Webmaster**: medía y para todo lo demás llamaba al Webmaster. El catálogo queda
en cinco puestos.

## Lo primero que hay que hacer mañana

0. ~~Fusionar el Velocista en el Webmaster~~ **Hecho el 22-sep por la noche**:
   el Webmaster lleva las herramientas `velocidad_*`, el guion de velocidad
   entra en su prompt solo cuando el encargo habla de velocidad (si no, un
   aviso de una línea), sus ajustes y campos de velocidad pasaron a la ficha
   del Webmaster, y la migración 0041 retira al Velocista del catálogo, cancela
   sus contratos, archiva sus agentes y pausa lo que tenía programado. Los
   encargos viejos con oficio «velocista» los ejecuta el Webmaster. El paquete
   `velocista` se queda como módulo del Webmaster. Cinco puestos en catálogo.

1. **Probar los otros agentes contra datos reales**, antes de construir el
   séptimo. Google Ads quedó probado entero el 22-sep (conexión, 37 cuentas
   de la agencia, campañas con métricas de una cuenta hija) y costó seis
   despliegues: cada adaptador sin estrenar trae cuatro o cinco sorpresas.
   Faltan PageSpeed, Alegra y el de imágenes.
   - **Larry → Instrucciones**: cambiarle la foto y pulsar **Mejorar con IA**.
   - **Conectar Alegra** en solo lectura y pedirle a Reportes «cómo vamos».
   - **Velocista**: «mide mi web y dime qué la hace lenta», con la clave puesta.
   - **Webmaster + Diseñador**: un artículo con portada.
2. **Verificación de Google**: enviada. Vigilar el correo de
   victor.sandoval@altotrafico.co por si piden algo.
3. **Dos detalles del agente de Marketing vistos el 22-sep**, sin tocar:
   «este mes» lo leyó como «últimos 7 días», y al no tener Analytics lo dijo
   bien pero gastó un paso en intentarlo.

---

## Decisiones ya tomadas, para no volver a discutirlas

- **No migrar a LangGraph**: resuelve media pieza (la reanudación y la espera de
  aprobación), la otra mitad ya la tenemos, y empuja hacia Python.
- **No usar el Claude Agent SDK**: está acoplado a modelos de Anthropic y el
  margen depende de poder elegir modelo barato.
- **Sí mover el programador a `pg-boss`, pero después de lanzar**. Es el trozo
  más genérico y el más fácil de sustituir sin tocar el producto.
- **No cambiar ningún cimiento antes del lanzamiento** de fin de septiembre.
- El **bucle del agente** (aprobaciones, pasos en vivo, freno de repeticiones,
  cobro) es el producto y sigue siendo nuestro.

---

## Riesgos conocidos

- **Deshacer**: cada cambio del Webmaster guarda copia, y desde el 22-sep el
  agente sabe listarlas (`wp_cambios_recientes`) y restaurar, incluido el
  diseño de Elementor. Probado: restauró la portada de Vox.
- **Adaptadores sin probar contra sus API reales**: PageSpeed, Alegra y el
  generador de imágenes. El primer encargo real los estrena. Google Ads se
  estrenó el 22-sep y costó cinco despliegues: contar con lo mismo.
- **Meta y TikTok Ads**: código listo, verificado solo contra dobles. Faltan
  los permisos de las plataformas (ver pendientes).
- **Emitir una factura en Colombia puede dispararla a la DIAN** según cómo esté
  configurada la cuenta. No se borra: se anula con nota crédito. Probarlo antes
  en una cuenta de pruebas.
- **El coste por imagen (100 créditos) es una estimación**: conviene mirar el
  consumo real de las primeras y ajustar la tarifa.
- **Delegar entre agentes multiplica el gasto** de un encargo. Mirar los
  primeros.
- **Los créditos ya vendidos** valían 3x y ahora rinden 2,5 veces más trabajo.
- **`agent_subscriptions.settings` es un dato muerto** para el worker: la verdad
  operativa vive ahora en la ficha de instrucciones del agente.
- **Sin pantalla global de trabajo programado**: se ve en la ficha de cada
  agente, no hay una lista del espacio.
- **Lección del 11-sep**, ahora en código: el flujo de despliegue aplica las
  migraciones antes de tocar el worker y falla si no arranca **estable**.
- **La contraseña del VPS se compartió por chat** (dos veces, el 22-sep).
  Cambiarla y pasar a acceso solo por clave.
