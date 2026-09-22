# El catálogo de agentes, por departamentos

Fecha: 12 de septiembre de 2026. Autor: agente de diseño de producto.
Estado: propuesta para decidir. Nada de esto está construido salvo lo que se
marca como **ya existe**.

## Para qué es este documento

Strappy se vende como una agencia: el cliente contrata agentes igual que
contrataría personas y solo paga los créditos que gastan trabajando. Hoy el
catálogo ofrece dos puestos (Webmaster y Marketing) y eso no se parece a una
empresa. Este documento propone la plantilla completa de tres departamentos
—Desarrollo, Marketing y Financiero—, qué hace cada puesto, a qué se conecta,
qué trámite hace falta para conectarlo y a qué sueldo sustituye.

La pregunta que gobierna cada decisión: **¿un dueño de negocio entra, lee la
ficha y dice «esto vale lo que cuesta»?** Si un agente no responde que sí, no
entra al catálogo.

### Tres reglas que ya son del producto y que no se tocan

1. **Nada que gaste dinero del cliente sin su aprobación explícita**, y la
   aprobación se lee en pesos, no en porcentajes ni en siglas.
2. **Se habla como un empleado, no como un panel de control.** «Esta campaña te
   cuesta 120.000 pesos por cada persona que escribe, el triple que la otra».
3. **No se inventan cifras.** Si un dato no se pudo leer, se dice.

### Lo que hace que esto parezca una oficina y no una lista de bots

Ya existe la pieza que lo cambia todo: un agente puede **pedirle ayuda a un
compañero** (`pedir_ayuda_a_companero`), y solo a quien el cliente tenga
contratado. El que ayuda trabaja con sus propios permisos y sus propias
aprobaciones, no hay cadenas infinitas (profundidad máxima 2) y el cliente ve
un solo encargo con un solo cargo, con el reparto en el registro de trabajo.

Ese detalle es el argumento de venta más fuerte del catálogo: **cuantos más
compañeros contrata, mejor trabaja cada uno**. El Webmaster que escribe un
artículo puede pedirle la imagen al diseñador; el financiero que persigue un
cobro puede pedirle al de Comunicaciones que lo mande por WhatsApp. Cada ficha
de este documento dice con quién colabora.

---

## Lo que ya existe hoy

| Paquete | Qué sabe hacer de verdad |
|---|---|
| `@strappy/webmaster` | WordPress completo: páginas y entradas con Elementor siguiendo el diseño real del sitio, plugins, usuarios, medios, comentarios, ajustes, copias de seguridad, navegador para verificar como un visitante. Más vigilancia del sitio cada 15 minutos con avisos. |
| `@strappy/marketing` | Google Ads, Meta Ads, TikTok Ads y Analytics detrás de puertos con dobles; adaptadores HTTP reales de las tres plataformas en `src/adaptadores/`; criterio de campañas contra la mediana del propio negocio; cambio de presupuesto con aprobación. Sin credenciales reales todavía. |
| `@strappy/administrativo` | Alegra: cartera, facturas, pagos, recordatorios de cobro. Su bucle se está enchufando ahora. |
| `@strappy/agentes` | El bucle común: aprobaciones, pasos en vivo, freno de repeticiones, tope de acciones y colaboración entre agentes. |
| `@strappy/whatsapp` | WhatsApp Cloud API. Somos Tech Provider: Meta le cobra las conversaciones al cliente, nosotros no revendemos mensajes. |

---

## Cuánto cuesta un empleado en Colombia (la vara con la que nos miden)

Estos números son el argumento de venta y conviene que estén en la ficha de
cada agente.

| Puesto | Sueldo mensual típico (2026) | Coste real para la empresa |
|---|---|---|
| Salario mínimo | $1.750.905 | ≈ $2.820.000 |
| Auxiliar contable | $1.315.000 – $1.536.000 | ≈ $2.000.000 – $2.400.000 |
| Asistente contable y administrativo | ≈ $1.601.000 | ≈ $2.400.000 – $2.600.000 |
| Community manager | $3.200.000 – $3.640.000 | ≈ $4.800.000 – $5.600.000 |
| Diseñador gráfico | $1.500.000 – $6.500.000 | ≈ $2.300.000 – $9.800.000 |
| Desarrollador web | $3.000.000 – $6.000.000 | ≈ $4.500.000 – $9.000.000 |

Por cada peso de sueldo, la empresa paga entre un **50% y un 55% adicional** en
seguridad social, prestaciones y provisiones. Un empleado con salario mínimo le
cuesta a la empresa cerca de **$2.820.000 al mes**.

**Y del otro lado, lo que cuesta un agente.** Medido con encargos reales del
11 de septiembre de 2026: un encargo completo del Webmaster —crear un artículo
con diseño, verificarlo en el navegador y enlazarlo en el blog— gastó 1.489
créditos con el modelo caro y 113 con el económico. Con las tarifas nuevas (el
margen del 20%, migración 0025) ese mismo encargo cuesta unos **600 créditos con
el modelo caro y unos 45 con el económico**. A 1.000 créditos por dólar y a la
tasa de ~3.230 COP/USD que registró el sistema contable ese día, son **entre 150
y 1.950 pesos por encargo**.

Veinte encargos al mes son **entre 3.000 y 39.000 pesos**. Esa es la frase que
vende: *el agente hace en un mes por menos de lo que cuesta una hora de la
persona a la que sustituye*.

---

# Departamento de Desarrollo

Quien mantiene la web y las herramientas. Hoy solo tiene al Webmaster, y es el
departamento donde más rápido se puede impresionar, porque **casi nada aquí
depende de un trámite externo**.

## 1. Webmaster — **ya existe**

> Mantiene tu web al día y te avisa antes de que se caiga.

**Qué hace.** Crea y edita páginas y entradas con Elementor siguiendo los
colores y las tipografías reales del sitio, instala y actualiza plugins,
gestiona usuarios y medios, guarda copia antes de tocar nada y verifica el
resultado en el navegador como lo vería un visitante. Además vigila el sitio
cada 15 minutos y avisa cuando algo cambia de estado.

**Encargos reales.** «Crea un blog de uso legal de la inteligencia artificial,
siguiendo los colores de la página». «Instala un plugin de caché». «La página de
contacto no envía el formulario, revísala».

**Conexión.** Usuario de WordPress y contraseña de aplicación. El cliente la
saca en su escritorio: Usuarios → Perfil → Contraseñas de aplicación →
escribir «Strappy» → Añadir. **Sin trámite externo.**

**Colabora con.** El diseñador (imágenes para los artículos), el de contenidos
(el texto), el analista web (qué páginas rinden mal).

**Sustituye a.** Un desarrollador web de mantenimiento o una agencia de soporte
mensual: **$3.000.000 – $6.000.000** al mes.

**Riesgo y aprobación obligatoria.** Puede romper un sitio en producción.
Instalar, activar o borrar plugins, tocar usuarios, cambiar ajustes globales y
reescribir la portada exigen aprobación. Todo lo destructivo guarda copia.

## 2. Guardián — **nuevo, sin trámite**

> Vigila que nadie se meta en tu web y que siempre haya una copia para volver.

**Qué hace.** Revisa quién tiene acceso al sitio y con qué permisos, detecta
usuarios administradores que nadie recuerda haber creado, avisa de plugins
abandonados o con vulnerabilidades conocidas, comprueba que las copias de
seguridad existen y son recientes, vigila el certificado y los intentos de
acceso sospechosos. Cuando algo está mal, propone el arreglo y espera permiso.

**Encargos reales.** «Revisa quién tiene acceso a mi página». «Me hackearon el
mes pasado, dime si quedó algo raro». «Asegúrate de que hay copia de todo antes
del lanzamiento del viernes».

**Herramientas.**
- *De leer:* listar usuarios y roles, listar plugins con su versión, comprobar
  el certificado, revisar la configuración expuesta, comparar contra el
  directorio público de WordPress para saber qué está desactualizado.
- *Con aprobación:* quitar un administrador de más, desactivar un plugin
  abandonado, forzar una copia, cambiar un rol.

**Conexión.** La misma de WordPress que ya usa el Webmaster. **Sin trámite.**

**Colabora con.** El Webmaster (aplicar el arreglo), el de Comunicaciones
(avisar por WhatsApp de un acceso raro).

**Sustituye a.** Un servicio de mantenimiento y seguridad, entre **$300.000 y
$1.500.000** al mes; o la factura de recuperar un sitio hackeado, que suele
costar más que un año de mantenimiento.

**Riesgo y aprobación obligatoria.** Quitarle el acceso a la persona
equivocada deja al dueño fuera de su propia web. Cualquier cambio de usuarios o
de roles exige aprobación con el nombre escrito. Nunca borra usuarios: los baja
de rol, que es reversible.

## 3. Velocista — **nuevo, sin trámite**

> Hace que tu página cargue rápido, que es lo que decide si te compran.

**Qué hace.** Mide la velocidad real de las páginas que importan, explica en
castellano qué las frena (imágenes pesadas, demasiados plugins, fuentes que
bloquean), y arregla lo que puede arreglarse sin romper el diseño: comprimir y
redimensionar imágenes, activar caché, aplazar lo que no hace falta al principio.
Vuelve a medir y enseña el antes y el después.

**Encargos reales.** «Mi página tarda mucho en cargar en celular, arréglalo».
«¿Por qué la página de servicios va lenta?». «Optimiza las imágenes de toda la
web».

**Herramientas.**
- *De leer:* medición de rendimiento por página (PageSpeed Insights), datos de
  usuarios reales (CrUX), inventario de imágenes y su peso, lista de plugins
  activos.
- *Con aprobación:* comprimir y reemplazar imágenes, instalar o configurar un
  plugin de caché, cambiar la carga de fuentes y scripts.

**Conexión.** Clave de la API de PageSpeed Insights, **gratuita**, con 25.000
consultas al día y un límite de 100 cada 100 segundos. La CrUX API da 150
consultas por minuto, también gratis. **Sin trámite ni aprobación externa**: se
crea en Google Cloud en minutos y la ponemos nosotros, no el cliente.

**Colabora con.** El Webmaster (aplicar cambios), el diseñador (regenerar una
imagen que perdió calidad al comprimir).

**Sustituye a.** Una consultoría de rendimiento web: **$1.500.000 – $4.000.000**
por proyecto, y normalmente se hace una vez y nunca más.

**Riesgo y aprobación obligatoria.** Comprimir mal una imagen arruina la marca;
un plugin de caché mal configurado tumba el sitio. Reemplazar imágenes e
instalar o tocar plugins de caché exigen aprobación y copia previa.

## 4. Diseñador — **nuevo, sin trámite**

> Te hace las imágenes que tu web y tus redes necesitan, con tu identidad.

**Qué hace.** Genera imágenes de portada para artículos, gráficas para
publicaciones, banners y recortes en los tamaños correctos, respetando los
colores y el estilo que ya tiene el sitio (ese estilo ya lo sabemos leer:
`sitio_leer_diseno` mide colores, tipografías, radios y botones reales). También
limpia fondos y adapta una misma pieza a varios formatos.

**Encargos reales.** «Hazme la imagen de portada para el artículo de IA».
«Necesito tres piezas para Instagram con la promoción de septiembre».
«Quítale el fondo a estas fotos de producto».

**Herramientas.**
- *De leer:* leer el diseño del sitio, listar la biblioteca de medios.
- *Con aprobación:* generar una imagen (cuesta créditos), subirla a la
  biblioteca, asignarla como imagen destacada.

**Conexión.** Ninguna del cliente. Usa nuestra propia cartera de modelos.
**Sin trámite.**

**Colabora con.** Es el compañero más pedido: el Webmaster le encarga la
portada del artículo, el de contenidos las piezas de redes, el Velocista la
versión ligera.

**Sustituye a.** Un diseñador gráfico: **$1.500.000 – $6.500.000** al mes, o
entre $80.000 y $250.000 por pieza si se paga por trabajo.

**Riesgo y aprobación obligatoria.** Generar imágenes gasta créditos y puede
producir cosas fuera de marca. Cada generación se aprueba, se ve antes de
publicarse y nunca reemplaza una imagen existente sin permiso.

## 5. SEO — **nuevo, trámite ligero**

> Te dice por qué te buscan y qué escribir para que te encuentren más.

**Qué hace.** Lee lo que ya pasa en Google con el sitio del cliente: qué
búsquedas lo traen, en qué posición está, qué páginas pierden posiciones, qué
consultas tienen muchas impresiones y pocos clics (el título no convence), qué
páginas tienen errores de indexación. Propone qué artículo escribir y con qué
título, y se lo encarga al Webmaster.

**Encargos reales.** «¿Por qué bajaron las visitas este mes?». «Dime qué
artículo escribir para vender más asesorías». «Revisa que Google esté indexando
bien la página nueva».

**Herramientas.**
- *De leer:* consultas, clics, impresiones y posiciones por página y por
  término; estado de indexación; comprobar que una URL está indexada.
- *Con aprobación:* pedir la indexación de una página nueva, cambiar títulos y
  descripciones (esto último lo ejecuta el Webmaster).

**Conexión.** Google Search Console. **Trámite ligero:** el permiso
`webmasters.readonly` es **no sensible** desde 2024, así que no exige la
verificación completa de Google. Solo conviene la verificación ligera para que
aparezcan nuestro nombre y logo en la pantalla de consentimiento. **Atención:**
si la app se queda en modo «Testing», los tokens caducan a los 7 días; hay que
publicarla.

**Colabora con.** El Webmaster (escribir y publicar), el de contenidos (el
texto), el analista web (qué pasa después del clic).

**Sustituye a.** Un consultor SEO: **$1.500.000 – $4.000.000** al mes.

**Riesgo y aprobación obligatoria.** Riesgo bajo: casi todo es lectura.
Cambiar títulos de páginas que ya posicionan puede hacer perder tráfico, así
que va con aprobación y con el valor anterior guardado.

---

# Departamento de Marketing

Quien sale a buscar clientes. Aquí está el dinero del cliente en juego, así que
aquí las aprobaciones importan más que en ningún sitio. Y aquí están los
trámites más largos.

## 1. Marketing (inversión en anuncios) — **ya existe, falta conectar**

> Vigila en qué se va tu inversión en anuncios.

**Qué hace.** Revisa las campañas de Google Ads, de Meta y de TikTok, compara cada una
contra la mediana del propio negocio (no contra promedios de sector), dice cuál
gasta sin traer clientes y cuál merece más presupuesto, y propone los cambios.
Con pocos clics dice «aún son pocos datos» en vez de condenar una campaña.

**Encargos reales.** «¿Cómo van mis campañas esta semana?». «¿En qué estoy
tirando el dinero?». «Súbele el presupuesto a la campaña que mejor va».

**Herramientas.**
- *De leer:* listar cuentas, revisar campañas con sus cifras, resumen de
  Analytics.
- *Con aprobación:* cambiar presupuesto, pausar y reactivar campañas.

**Conexión y trámite.** Es el camino crítico de todo el lanzamiento. El código
ya está: adaptadores de las tres plataformas y su conexión en Ajustes → Canales
(`GOOGLE_ADS_*`, `META_APP_*`, `TIKTOK_APP_*`). Lo que falta son los accesos:

| Plataforma | Qué hace falta | Plazo real |
|---|---|---|
| Google Ads | Token de desarrollador ligado a un proyecto de Google Cloud. Existe un nivel **Explorer** que da capacidades de producción **sin aprobación formal**, y el nivel **Basic** que sí se solicita | Basic: 5 días hábiles oficiales, con retrasos conocidos en 2026. La **verificación de marca** (piloto desde julio de 2026) baja la espera a horas |
| Meta Ads | Si solo se leen cuentas del propio portafolio, basta un usuario de sistema: **inmediato**. Para cuentas de clientes, revisión de la app y verificación del negocio | 3–5 días hábiles la verificación; la revisión, más |
| TikTok Ads | App en TikTok for Business con permisos de Ads Management. El anunciante autoriza desde el portal de TikTok | Revisión de la app: días |
| Google Analytics | El permiso `analytics.readonly` es **sensible** y exige verificación de la app | Normalmente 1–2 días; hasta ~10 si hay idas y venidas |

**Ojo con Google Ads:** no existe permiso de solo lectura. El mismo permiso lee
y escribe, así que la protección contra gastar de más es nuestra y por eso vive
en el código.

**Colabora con.** El analista web (qué pasa después del clic), el de contenidos
(reescribir los anuncios que no funcionan), el financiero (cuánto se puede
gastar de verdad este mes).

**Sustituye a.** Una agencia de medios o un pauta manager: **$1.500.000 –
$5.000.000** al mes, normalmente más un porcentaje de la inversión.

**Riesgo y aprobación obligatoria.** Es el agente que puede gastar dinero de
verdad. Todo cambio de presupuesto y toda pausa exigen aprobación, con el
importe mensual escrito en pesos, con el valor anterior guardado y con un tope:
nunca triplicar un presupuesto de una sola vez.

## 2. Contenidos — **nuevo, sin trámite para lo importante**

> Escribe lo que publicas, con tu voz y sin inventarse nada de tu negocio.

**Qué hace.** Escribe artículos completos para el blog con el diseño del sitio,
textos para redes, descripciones de producto y respuestas a preguntas
frecuentes, apoyándose en el Conocimiento del negocio que el cliente ya cargó
(documentos, web, precios). Nada de texto genérico: cita lo que el negocio dice
de sí mismo.

**Encargos reales.** «Escribe el artículo del mes sobre reformas de vivienda».
«Hazme diez publicaciones para Instagram de la promoción de octubre».
«Reescribe la página de servicios, que suena acartonada».

**Herramientas.**
- *De leer:* buscar en el Conocimiento, leer el sitio, leer lo que ya se
  publicó para no repetirse.
- *Con aprobación:* publicar en el blog (lo ejecuta el Webmaster), publicar en
  redes (ver más abajo).

**Conexión y trámite.** Para el blog, **ninguno**: va por el Webmaster. Para
publicar en Instagram hace falta la API de Instagram con
`instagram_business_basic` e `instagram_business_content_publish`, cuenta
profesional vinculada a una página de Facebook, y **revisión de la app de Meta:
2 a 4 semanas por permiso**. El límite son 100 publicaciones cada 24 horas.

**Recomendación:** lanzar este agente **escribiendo y dejando listo el
contenido**, y dejar la publicación automática en redes para cuando Meta
apruebe. Escribir ya es la mitad del valor y no depende de nadie.

**Colabora con.** El diseñador (las piezas), el SEO (sobre qué escribir), el
Webmaster (publicar).

**Sustituye a.** Un community manager o un redactor: **$3.200.000 –
$3.640.000** al mes, y es el puesto que Pedro ya intentó vender dos veces sin
éxito porque nadie quiere pagar eso.

**Riesgo y aprobación obligatoria.** Publicar algo mal escrito a nombre del
negocio es un daño de marca difícil de deshacer. Toda publicación se aprueba y
se ve antes.

## 3. Analista web — **nuevo, trámite corto**

> Te cuenta qué hace la gente en tu web y dónde la estás perdiendo.

**Qué hace.** Junta lo que pasa antes del clic (Search Console) con lo que pasa
después (Analytics): de dónde llega la gente, qué páginas la retienen, en qué
paso del formulario se cae, qué canal trae clientes y cuál solo trae visitas.
Compara con el mes anterior y explica los cambios.

**Encargos reales.** «¿Por qué bajaron las ventas si las visitas subieron?».
«¿De dónde viene la gente que sí compra?». «Compara este mes con el pasado».

**Herramientas.** Solo de lectura: informes de Analytics por periodo, canales,
páginas y conversiones; datos de Search Console. **No cambia nada**, y por eso
es el agente más seguro del departamento.

**Conexión y trámite.** Google Analytics (permiso sensible, verificación de 1–2
días) y Search Console (permiso no sensible, sin verificación pesada).

**Colabora con.** Marketing (qué campaña vale la pena), SEO (qué contenido
funciona), el Velocista (páginas lentas que pierden gente).

**Sustituye a.** Un analista de marketing: **$3.000.000 – $5.000.000** al mes.

**Riesgo.** Prácticamente ninguno: no escribe. El único riesgo es afirmar de
más, y para eso está la regla de no inventar cifras.

## 4. Reputación — **nuevo, trámite largo**

> Cuida lo que dicen de ti en Google y contesta todas las reseñas.

**Qué hace.** Vigila las reseñas del negocio en Google, avisa de las malas
apenas llegan, redacta la respuesta para cada una con el tono del negocio, y
mantiene al día la ficha (horarios, teléfono, fotos, festivos).

**Encargos reales.** «Respóndeme todas las reseñas pendientes». «Avísame apenas
me dejen una de una o dos estrellas». «Actualiza los horarios de diciembre».

**Herramientas.**
- *De leer:* listar reseñas y su calificación, leer la ficha del negocio.
- *Con aprobación:* publicar una respuesta, cambiar horarios o datos de la
  ficha, subir fotos.

**Conexión y trámite.** API de Google Business Profile. Hay que **solicitar
acceso**: Google dice 7–10 días hábiles y revisa en 14; en la práctica la gente
reporta entre 4 días y 6 semanas. Exige una ficha verificada con más de 60 días
de actividad, un sitio web válido y una descripción del caso de uso que no sea
vaga, porque las vagas se rechazan.

**Colabora con.** El de Comunicaciones (avisar de una reseña mala por WhatsApp
al instante), Contenidos (el tono de la respuesta).

**Sustituye a.** La parte de reputación de un community manager, y sobre todo
evita el costo invisible de una reseña de una estrella sin responder.

**Riesgo y aprobación obligatoria.** Una respuesta pública mal medida empeora
el problema. Toda respuesta y todo cambio de la ficha se aprueban.

## 5. Email — **nuevo, sin trámite (opcional)**

> Escribe y envía los correos a tus clientes, y te dice quién los abrió.

**Qué hace.** Prepara campañas de correo a partir del Conocimiento y de los
contactos, segmenta por lo que ya se sabe de cada uno, envía y reporta
aperturas y clics. Respeta las bajas sin excepción.

**Conexión y trámite.** Brevo o similar: clave de API, **sin aprobación**; 300
correos gratis al día. Hay que configurar SPF, DKIM y DMARC del dominio del
cliente, que es un paso técnico real pero de minutos.

**Sustituye a.** La parte de email marketing de una agencia: **$800.000 –
$2.500.000** al mes.

**Riesgo y aprobación obligatoria.** Un envío masivo mal hecho quema el dominio
del cliente para siempre. Cada envío se aprueba, con el número de destinatarios
escrito, y las bajas se respetan sin discusión.

---

# Departamento Financiero

El que Pedro describió por la persona que hoy hace el trabajo: «monta pagos,
manda facturas, concilia con los contadores, cierra caja». Es el departamento
donde el dueño ve el dinero, y donde un error cuesta más caro.

## 1. Administrativo (cartera y cobros) — **ya existe, falta conectar**

> Te dice cuánto te deben y persigue a los que no pagan.

**Qué hace.** Dice cuánto hay por cobrar, qué está vencido y desde cuándo, qué
vence esta semana y cuánto entró. Ordena la cartera por **dinero parado por
tiempo parado**, que es como lo vive quien paga la nómina. Prepara el
recordatorio de cobro y se lo pasa al de Comunicaciones para que lo envíe.

**Encargos reales.** «¿Cuánto me deben?». «¿A quién tengo que cobrarle esta
semana?». «Mándale recordatorio a los que llevan más de 60 días».

**Conexión.** Alegra: correo del usuario y **token de la API** (Configuración →
API). **Sin trámite externo**, se genera en el momento. Conviene un usuario
propio para Strappy, no el personal del dueño, para poder revocarlo sin romper
nada.

**Colabora con.** El de Comunicaciones (enviar el recordatorio por WhatsApp),
Marketing (cuánto se puede gastar este mes de verdad).

**Sustituye a.** Un auxiliar contable: **$1.315.000 – $1.536.000** al mes, que
le cuesta a la empresa entre **$2.000.000 y $2.400.000**.

**Riesgo y aprobación obligatoria.** Ya está resuelto: nada que cree, modifique
o anule un documento contable se hace sin aprobación, con el importe y el
cliente escritos.

## 2. Facturador — **nuevo, trámite del cliente**

> Emite tus facturas electrónicas sin que tengas que abrir el programa.

**Qué hace.** Convierte en factura lo que el cliente describe en una frase,
con sus ítems, impuestos y numeración correcta; la deja en borrador o la emite;
programa las recurrentes (los que pagan mensual) y avisa cuando una se va a
emitir.

**Encargos reales.** «Factúrale a Distribuciones Pérez los tres servicios de
septiembre, el primero sin IVA». «Emite las facturas mensuales de mis clientes
de mantenimiento». «Hazme la factura de esta cotización».

**Conexión y trámite.** La misma de Alegra. **Pero hay un trámite serio del
lado del cliente:** para emitir factura electrónica válida hay que estar
habilitado ante la DIAN. El token de habilitación llega al correo registrado en
el RUT, hay un ambiente de pruebas disponible 24/7 y, una vez la DIAN acepta el
set de pruebas, la empresa queda autorizada. Alegra afirma que el proceso se
completa en unos 10 minutos si el RUT está en orden.

**Advertencia que debe salir en la aprobación:** emitir una factura de venta
puede dispararla a la DIAN según cómo esté configurada la cuenta. Antes de dejar
que el agente emita de verdad, hay que probarlo en una cuenta de pruebas.

**Sustituye a.** La parte de facturación de un asistente contable y
administrativo: **≈ $1.601.000** al mes, **≈ $2.500.000** para la empresa.

**Riesgo y aprobación obligatoria.** **Es el agente de mayor riesgo de todo el
catálogo.** Una factura electrónica emitida ante la DIAN no se borra: se anula
con nota crédito, y queda el rastro. Emitir, anular y cambiar numeraciones
exigen aprobación con el importe, el cliente y el aviso de la DIAN escritos.

## 3. Conciliador — **nuevo, trámite largo**

> Cuadra lo que entró al banco con lo que facturaste.

**Qué hace.** Cruza los movimientos del banco con las facturas y los pagos
registrados, señala lo que no cuadra (un pago sin factura, una factura pagada
que sigue abierta, un cobro duplicado) y propone el asiento que falta. Cierra la
caja del día o del mes.

**Encargos reales.** «Concíliame septiembre». «Entró una plata al banco y no sé
de quién es». «Ciérrame la caja del mes».

**Conexión y trámite.** Dos caminos:
- **Fácil y sin trámite:** el cliente sube el extracto bancario (CSV o Excel) y
  el agente concilia contra Alegra. Esto se puede construir ya.
- **Automático:** conexión bancaria vía Belvo, que opera en Colombia y está
  regulado por la Circular 004 de 2024 de la Superintendencia Financiera. Es un
  contrato B2B con requisitos de seguridad para terceros receptores de datos:
  **semanas o meses**, y probablemente mínimos comerciales.

**Recomendación:** empezar por el extracto subido. El 90% del valor con el 5%
del trámite.

**Colabora con.** El Administrativo (marcar facturas pagadas), el Facturador.

**Sustituye a.** Las horas del contador externo, **$500.000 – $2.000.000** al
mes, y sobre todo el trabajo de fin de mes que nadie quiere hacer.

**Riesgo y aprobación obligatoria.** Registrar un pago que no existe descuadra
la contabilidad y puede hacer que se deje de cobrar una deuda real. Todo
registro de pago y toda conciliación se aprueban, y nunca se registra un pago
mayor que el saldo pendiente.

## 4. Reportes (el que cierra el mes) — **nuevo, sin trámite**

> Cada lunes te dice cómo va el negocio en una página.

**Qué hace.** Un resumen periódico y automático: cuánto entró, cuánto salió,
cuánto hay por cobrar, cuánto por pagar, comparado con el mes anterior y con el
mismo mes del año pasado. Señala lo que cambió y por qué. Es el «al final que a
usted le diga: tenemos tanta plata, nos falta tanta plata» que pidió Pedro.

**Encargos reales.** «¿Cómo vamos este mes?». «Mándame el resumen todos los
lunes». «¿Por qué gastamos más que el mes pasado?».

**Herramientas.** Solo lectura: informes de Alegra (cartera, estado de
resultados, flujo de caja), gastos y pagos por periodo.

**Conexión.** La misma de Alegra. **Sin trámite.**

**Colabora con.** El de Comunicaciones (mandar el resumen por WhatsApp el lunes
a las 8), Marketing (cuánto hay para pauta este mes).

**Sustituye a.** La parte de reportes de un asistente administrativo y las
horas del contador explicando lo mismo cada mes.

**Riesgo.** Ninguno de escritura. El riesgo es decir un número mal, y contra eso
está la regla de no inventar cifras y citar siempre de dónde sale cada una.

**Nota:** este agente necesita **tareas programadas**, que hoy no existen. Es la
pieza de plataforma que más valor desbloquea en todo el catálogo, porque
convierte agentes que responden en empleados que trabajan solos.

---

## Qué se puede construir sin depender de nadie

Esto se puede terminar sin pedirle permiso a ninguna plataforma:

| Agente | Departamento | Por qué no depende de nadie |
|---|---|---|
| **Guardián** | Desarrollo | Usa la conexión de WordPress que ya existe |
| **Velocista** | Desarrollo | PageSpeed y CrUX son gratis y sin aprobación |
| **Diseñador** | Desarrollo | Usa nuestra propia cartera de modelos |
| **Contenidos** (escribir) | Marketing | Publica por el Webmaster |
| **Reportes** | Financiero | Solo lee Alegra |
| **Conciliador** (extracto subido) | Financiero | El cliente sube el archivo |
| **Facturador** (dejar en borrador) | Financiero | Emitir es lo que exige la DIAN |

Y esto está bloqueado por un tercero:

| Agente | Trámite | Plazo | Quién lo inicia |
|---|---|---|---|
| Marketing · Google Ads | Token de desarrollador (o nivel Explorer, sin aprobación) | Horas con verificación de marca; días o semanas sin ella | **Nosotros** |
| Marketing · Meta Ads | Usuario de sistema (propio) o revisión de app (clientes) | Inmediato / 3–5 días + revisión | **Nosotros** |
| Marketing · Analytics | Verificación de permiso sensible | 1–2 días, hasta ~10 | **Nosotros** |
| SEO · Search Console | Verificación ligera (permiso no sensible) | Días | **Nosotros** |
| Contenidos · publicar en redes | Revisión de app de Meta | 2–4 semanas por permiso | **Nosotros** |
| Reputación · Google Business | Solicitud de acceso | 7–10 días hábiles oficiales; 4 días a 6 semanas real | **Nosotros** |
| Facturador · DIAN | Habilitación como facturador electrónico | Minutos si el RUT está en orden | **El cliente** |
| Conciliador · banco | Contrato con Belvo | Semanas o meses | **Nosotros** |

---

## Orden de construcción para llegar a fin de septiembre

Quedan poco más de dos semanas. La estrategia es simple: **lo que impresiona al
entrar y no depende de nadie va primero; lo que depende de un tercero se
tramita hoy y se construye mientras esperamos.**

**Hoy mismo, sin escribir código:** iniciar los trámites de Google Ads (con
verificación de marca, que baja la espera a horas), Analytics, Search Console y
Google Business Profile. Cada día que se retrasa una solicitud es un día que se
retrasa el lanzamiento de ese agente.

**Semana 1 — que el catálogo se vea lleno y funcione**
1. **Tareas programadas** en el worker. No es un agente, es la pieza que
   convierte a todos en empleados. Sin esto, Reportes y la vigilancia solo
   responden cuando les preguntan.
2. **Diseñador.** Es el que más «wow» da por peso: el Webmaster le pide la
   portada y el cliente ve a dos agentes trabajando juntos en un mismo encargo.
3. **Reportes.** Barato de construir (solo lee Alegra, que ya está) y es lo que
   el dueño mira todos los lunes.

**Semana 2 — profundidad donde ya somos fuertes**
4. **Velocista.** Mide, arregla y enseña el antes y el después. El resultado se
   ve en un número que mejora, que es la demostración más fácil de entender.
5. **Guardián.** Mismo terreno que el Webmaster, riesgo controlado, y contesta
   un miedo real («¿me pueden hackear?»).
6. **Contenidos**, en modo escribir y publicar en el blog.

**Cuando lleguen los permisos**
7. **Analista web** y **SEO**, que son solo lectura y por tanto rápidos de
   construir una vez hay acceso.
8. **Conciliador** con extracto subido, y **Facturador** en modo borrador.
9. **Reputación**, que es el trámite más impredecible.

Con eso, a fin de septiembre el catálogo enseña **ocho o nueve puestos**, de los
cuales cinco o seis funcionan de verdad sin depender de nadie, y los demás dicen
con honestidad qué les falta para empezar.

---

## Qué NO deberíamos hacer todavía

- **Nómina electrónica.** Alegra la soporta y la DIAN la exige, pero equivocarse
  en la nómina de alguien es un problema laboral, no un error de software. No
  antes de tener el Facturador funcionando meses sin incidentes.
- **Publicación automática en redes sin supervisión.** Aunque Meta apruebe,
  publicar sin que una persona lo vea es el camino más corto a un incidente de
  marca. Primero aprobación siempre; la automatización, más adelante y solo si
  el cliente la pide.
- **Conexión bancaria directa.** El trámite es largo y caro, y el extracto
  subido resuelve casi todo. Se hace cuando haya clientes suficientes que lo
  paguen.
- **Un agente «community manager» completo** que publique en todas las redes.
  Suena bien y es donde más fácil se queda corto. Mejor Contenidos escribiendo
  excelente que un community manager mediocre.
- **Agentes de recursos humanos, legal o atención telefónica.** Están fuera de
  lo que el producto sabe hacer hoy y cada uno abre un frente de riesgo nuevo.
- **Cobrar por contratar un agente.** Ya está decidido: se contratan los que se
  quieran y se pagan los créditos. Un catálogo grande con contratación gratis es
  precisamente lo que hace que el cliente pruebe cinco agentes en vez de uno.

---

## Resumen de riesgos, por si hay que priorizar la revisión humana

| Agente | Lo peor que puede pasar | Aprobación obligatoria |
|---|---|---|
| Facturador | Factura emitida ante la DIAN que no se puede borrar | Emitir, anular, cambiar numeración |
| Marketing | Gastar de más el dinero del cliente | Cambiar presupuesto, pausar, reactivar |
| Guardián | Dejar al dueño sin acceso a su web | Tocar usuarios y roles |
| Webmaster | Romper el sitio en producción | Plugins, ajustes globales, portada |
| Velocista | Arruinar imágenes o tumbar el sitio con caché | Reemplazar imágenes, plugins de caché |
| Conciliador | Descuadrar la contabilidad | Registrar pagos, conciliar |
| Email | Quemar el dominio del cliente | Cada envío, con destinatarios a la vista |
| Contenidos | Publicar algo mal a nombre del negocio | Cada publicación |
| Reputación | Empeorar una crisis con una respuesta pública | Cada respuesta y cambio de ficha |
| Diseñador | Gastar créditos y salirse de la marca | Cada generación |
| SEO | Perder posiciones al cambiar títulos | Cambiar títulos y descripciones |
| Analista web | Decir un número mal | Ninguna (solo lee) |
| Reportes | Decir un número mal | Ninguna (solo lee) |

---

## Fuentes

- [Developer token sunset · Google Ads API](https://developers.google.com/google-ads/api/docs/get-started/dev-token)
- [Access levels · Google Ads API](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
- [Google faces developer token application backlog as new API tier debuts · PPC Land](https://ppc.land/google-faces-developer-token-application-backlog-as-new-api-tier-debuts/)
- [High Demand Slows Google Ads API Access Approvals · PPC News Feed](https://ppcnewsfeed.com/ppc-news/2026-02/high-demand-slows-google-ads-api-access-approvals/)
- [Meta Ads API: Setup, Automation & Real Limits (2026) · AdManage](https://admanage.ai/blog/meta-ads-api)
- [Facebook Ads API Permission App Review: 2026 Guide](https://singhamandeep.com/facebook-ads-api-permission-app-review/)
- [Sensitive scope verification · Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Google Search Console API Authentication · GSCDump](https://gscdump.com/learn-google-search-console/api/authentication)
- [Prerequisites · Google Business Profile APIs](https://developers.google.com/my-business/content/prereqs)
- [Applying for Google Business Profile API access · Google](https://support.google.com/business/workflow/16726127?hl=en)
- [Publish Content using the Instagram Platform · Meta](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Instagram Graph API in 2026 · Netrows](https://www.netrows.com/blog/instagram-graph-api-guide-2026)
- [Measure Core Web Vitals with the PageSpeed Insights API and CrUX · Google](https://developers.google.com/codelabs/chrome-web-vitals-psi-crux)
- [CrUX API · Chrome for Developers](https://developer.chrome.com/docs/crux/api)
- [Guía del proceso de habilitación en la DIAN · Alegra](https://e-provider-docs.alegra.com/docs/proceso-de-habilitaci%C3%B3n-en-la-dian)
- [API de Facturación Electrónica en Colombia · Alegra](https://www.alegra.com/colombia/api/facturacion-electronica/)
- [Pricing on the WhatsApp Business Platform · Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Colombia WhatsApp API Pricing 2026 · Ominiflow](https://ominiflow.com/whatsapp-api-pricing/colombia)
- [Costo real de un empleado en Colombia 2026 · Buk](https://www.buk.co/blog/costo-real-de-un-empleado-en-colombia-2026)
- [Salario mínimo Colombia 2026 · Alegra](https://blog.alegra.com/colombia/salario-minimo-en-colombia-2026/)
- [Salario de Community manager en Colombia · Computrabajo](https://co.computrabajo.com/salarios/community-manager)
- [Salario de Auxiliar contable en Colombia · Computrabajo](https://co.computrabajo.com/salarios/auxiliar-contable)
- [Salario de Asistente contable y administrativo · Computrabajo](https://co.computrabajo.com/salarios/asistente-contable-y-administrativo)
- [Salario de un desarrollador web en Colombia 2026 · TripleTen](https://tripleten.co/blog/cuanto-gana-desarrollador-web-colombia/)
- [Sueldo Diseñador Gráfico en Colombia 2026](https://curso-diseno-grafico.org/sueldo-disenador-grafico-colombia/)
- [Colombia regula el open finance · Belvo](https://belvo.com/es/blog/colombia-regula-open-finance-paso-hacia-inclusion-financiera/)
- [Email Marketing API: Complete Developer Guide (2026) · Brevo](https://www.brevo.com/blog/email-marketing-api/)
