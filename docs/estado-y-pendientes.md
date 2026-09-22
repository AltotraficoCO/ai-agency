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
| **Verificación de marca en Google** | Victor + Claude | desbloquea el nivel Básico de la API y quita el aviso de «app no verificada». Falta: TXT de Search Console en GoDaddy, y el vídeo del flujo (Claude lo monta; falta clave de ElevenLabs o voz local) |
| **Dominio propio en Supabase** (`auth.strappy.io`) | Victor | la pantalla de Google enseña `witlvqvwbgixlewzdbfe.supabase.co` al iniciar sesión. Plan Pro + complemento, ~35 USD/mes |
| **Correo de contacto y razón social** en las páginas legales | Victor | hoy `hola@strappy.io` y «Strappy» sin NIT |
| **Acceso al VPS solo por clave SSH** | Victor | la contraseña se compartió por chat dos veces; conviene desactivar el acceso por contraseña |
| Permiso de **Meta** para publicar por clientes | Victor | 2 a 4 semanas de revisión. Para anuncios hacen falta además `ads_read` y `ads_management` en la misma app |
| App de **TikTok for Business** | Victor | permisos de Ads Management; va en `TIKTOK_APP_ID` y `TIKTOK_APP_SECRET` |
| Clave de **PageSpeed** (`PAGESPEED_API_KEY` en el VPS) | Victor | gratis y en minutos; sin ella el Velocista no mide |
| **Token de Alegra** (usuario propio para Strappy, no la contraseña) | Pedro | sin él, Administrativo y Reportes no tienen dónde mirar |
| **Cuadrar las claves de cifrado** | Victor | la `APP_ENCRYPTION_KEY` de Vercel y la del VPS (`/etc/strappy-worker.env`) tienen que ser idénticas. Desde hoy, si no lo son, el agente de Marketing lo dice con esas palabras en vez de «no hay plataformas». Pendiente de confirmar con el primer encargo real |
| **Plantilla de WhatsApp en Meta** (categoría utilidad) | Victor | sin ella no se envía ningún aviso |
| **Precios nuevos en Stripe** | Victor | la web ya dice 100, 500 y 1.500; el cobro sigue en los precios viejos |
| **OpenRouter a cuenta de empresa** con recarga automática | Victor | hoy es una cuenta personal, con tope de 5 USD |
| **Cuatro definiciones del puesto administrativo** | Pedro | desde cuántos días perseguir, si emite o solo prepara, qué impuesto, en qué cuenta |
| **Cuatro personajes propios** | decisión | Diseñador, Velocista, Administrativo y Reportes llevan caras prestadas. Unos 1.300 pesos si se los encarga al Diseñador |

---

## Lo primero que hay que hacer mañana

1. **Marketing con datos reales**: «qué cuentas de ads hay» y «cómo van mis
   campañas este mes». Es la última llamada del adaptador de Google (la
   búsqueda de campañas) que no se ha estrenado. Si dice que no puede abrir
   las credenciales, cuadrar `APP_ENCRYPTION_KEY` y reiniciar el worker.
2. **Probar los otros agentes contra datos reales**, antes de construir el
   séptimo. Google Ads enseñó la lección: cada adaptador sin estrenar trae
   cuatro o cinco sorpresas. Faltan PageSpeed, Alegra y el de imágenes.
   - **Larry → Instrucciones**: cambiarle la foto y pulsar **Mejorar con IA**.
   - **Conectar Alegra** en solo lectura y pedirle a Reportes «cómo vamos».
   - **Velocista**: «mide mi web y dime qué la hace lenta», con la clave puesta.
   - **Webmaster + Diseñador**: un artículo con portada.
3. **Vídeo de verificación de Google**, con el flujo ya funcionando.

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
