# Design System Master File — Strappy

> **LOGIC:** When building a specific page, first check `design-system/strappy/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Strappy — plataforma de agentes de IA (atención por WhatsApp + agentes por encargo)
**Generated with:** UI UX Pro Max (`search.py --design-system`), corregido a mano el 2026-09-11
**Category:** SaaS · AI-native product UI
**Users:** dueños de pequeños negocios, NO técnicos. Todo en español.
**Visual reference:** https://uupm.cc/demo/developer-tools

La primera generación clasificó mal el producto (podcast / landing de app store / violeta). Se mantienen de ella la tipografía y el estilo Dark Mode (OLED); del estilo **AI-Native UI** se toman los patrones de interacción.

---

## 1. Principios (en orden de prioridad)

1. **Una acción principal por pantalla**, visible sin buscar: botón primario arriba a la derecha del encabezado, o en el centro de un estado vacío.
2. **Nunca una pantalla muerta.** Todo estado vacío explica qué pasa aquí y ofrece el botón que lo arregla.
3. **Lo técnico se esconde.** Prompts, JSON, IDs y Markdown crudo nunca se enseñan por defecto; van detrás de «Ver detalles técnicos».
4. **Todo responde.** Hover, pulsación, carga, éxito y error tienen su estado visible (150–300 ms).
5. **La IA se nota viva.** Indicador de escritura, texto que aparece, tarjetas de contexto, apariciones suaves.
6. **El contenido llena el espacio con intención.** Nada de paneles de 500 px flotando en un lienzo vacío.

---

## 2. Color (tokens en `apps/web/src/app/globals.css`)

| Rol | Oscuro | Uso |
|-----|--------|-----|
| Page | `#0D0D0D` | fondo |
| Raised / card | `#161616` | tarjetas, paneles |
| Overlay | `#1E1E1E` | popovers, menús |
| Border | `#27272A` | bordes de 1 px |
| Text | `#E4E4E7` | texto principal |
| Muted | `#71717A` | texto secundario (nunca en párrafos largos) |
| Brand / CTA | `#39FF14` | UNA acción primaria, estados activos, foco |
| On brand | `#000000` | texto sobre verde |
| Human | `#0080FF` | lo que hace una persona del equipo |

Reglas:
- El neón es un **acento**, no un color de texto de párrafo. Nunca texto largo verde; nunca texto verde sobre fondo verde.
- Burbujas de la IA: `bg-raised` + borde + texto `fg`. El verde solo en el avatar o en una marca pequeña.
- Máximo un botón primario verde visible por zona.
- Glow solo en hover del botón primario y en el foco (`--brand-glow`).

## 3. Tipografía

- Cuerpo: **IBM Plex Sans** 14 px (UI) / 15 px (chat). Títulos 600.
- Mono: **JetBrains Mono** solo para cifras técnicas, atajos y códigos. Nunca para texto de negocio.
- Encabezado de página: 22 px / 600 + descripción 14 px muted, máx. 70 caracteres por línea.

## 4. Espaciado y layout

- Contenedor de página: `max-w-6xl mx-auto px-6 py-8` (listas y paneles), `max-w-3xl` (formularios y lectura).
- Encabezado de página (`EncabezadoPagina`): título + descripción a la izquierda, acciones a la derecha, `mb-6`.
- Rejillas de tarjetas: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` (o 4 para agentes).
- Radios: botón 6 px · input 6 px · tarjeta 12 px · burbuja 16 px.

## 5. Componentes

### Botones
- Primario: `bg-primary text-black font-semibold`, hover `brand-hover` + glow, `active:scale-[0.98]`.
- Secundario: transparente, borde `border`, hover borde verde y texto verde.
- Ghost para acciones terciarias. Iconos Lucide 16 px.
- Estado de carga: spinner dentro del botón y deshabilitado.

### Tarjetas interactivas
- `bg-raised border rounded-xl`, hover: `border-primary/50` + `-translate-y-0.5` + sombra; `cursor-pointer`.
- Toda la tarjeta es el enlace; los menús secundarios van encima con `z-10`.

### Estados vacíos
- Icono en círculo con halo sutil, título 18 px, una frase, **botón primario** y opcional enlace secundario.

### Chat (AI-Native UI)
- Burbuja persona: derecha, `bg-selected`.
- Burbuja IA: izquierda, avatar, `bg-raised` + borde, texto `fg`.
- Indicador «escribiendo»: tres puntos con pulso escalonado mientras llega la respuesta.
- Aparición de mensajes: `strappy-slide-up` (200 ms).
- Markdown ligero renderizado (negritas, listas, enlaces); nunca `**`, `##` o `---` crudos.
- Tarjetas de contexto (resultado de herramientas) con borde izquierdo de marca.

### Formularios
- Label visible siempre; ayuda debajo en muted; error debajo en danger con icono.
- Progreso visible en asistentes de varios pasos («Paso 2 de 4») sin truncar etiquetas.

---

## 6. Motion

- Micro-interacciones 150–200 ms, `--ease-out-quart`.
- Entrada de contenido: fade + slide-up 8 px.
- Solo `transform` y `opacity`.
- `prefers-reduced-motion`: sin animación.

---

## 7. Anti-patrones (NO usar)

- ❌ Emojis como iconos (también en textos generados por la IA que se pintan como UI)
- ❌ Texto neón en párrafos o sobre fondo verde
- ❌ Estados vacíos sin acción
- ❌ Prompts, `##`, `**`, JSON visibles para el cliente por defecto
- ❌ Paneles estrechos centrados en un lienzo vacío
- ❌ Hover que desplaza el layout (scale en contenedores)
- ❌ Clickables sin `cursor-pointer`
- ❌ Etiquetas truncadas en pasos de un asistente
- ❌ La IA repitiendo en texto lo que una tarjeta ya enseña

---

## 8. Pre-Delivery Checklist

- [ ] Una acción principal clara por pantalla
- [ ] Estados vacíos con botón
- [ ] Sin emojis como iconos; iconos Lucide coherentes
- [ ] `cursor-pointer` y hover en todo lo clicable
- [ ] Transiciones 150–300 ms; `prefers-reduced-motion` respetado
- [ ] Contraste 4.5:1 (sin texto verde sobre verde)
- [ ] Foco visible
- [ ] Responsive 375 / 768 / 1024 / 1440 px, sin scroll horizontal
