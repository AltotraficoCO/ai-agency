import "server-only";

/**
 * Catálogo de agentes contratables.
 *
 * El catálogo es PRODUCTO, no dato de cliente: `catalog_agents` es una tabla
 * global sin `workspace_id`. Contratar uno crea dos filas en el espacio del
 * cliente —un `agents` de tipo `catalog` y su `agent_subscriptions`— y ambas
 * en la misma transacción: un agente sin contrato se factura mal, y un contrato
 * sin agente no atiende a nadie.
 *
 * El precio del agente NO se escribe aquí: sale de `catalog_agents.monthly_credits`.
 * Hoy la semilla lo deja en cero y por eso la ficha dice «incluido en tu plan»;
 * el día que se ponga precio, la ficha lo dirá sola sin tocar este archivo.
 */
import { desdePlantillaDeCatalogo } from "@strappy/db/spec";
import { conEspacio } from "@/lib/db/pool";
import { creditosAUsd } from "./planes";

export type ConexionRequerida = {
  readonly clave: string;
  readonly nombre: string;
  readonly descripcion: string;
  /** true si el espacio ya la tiene lista. */
  readonly lista: boolean;
  readonly ruta: string;
};

export type CampoPersonalizable = {
  readonly clave: string;
  readonly etiqueta: string;
  readonly ayuda: string;
  readonly tipo: "texto" | "parrafo" | "opcion";
  readonly opciones?: readonly { valor: string; etiqueta: string }[];
  readonly valorPorDefecto: string;
};

/** Iconos con los que se pinta cada capacidad; el componente decide el dibujo. */
export type IconoCapacidad =
  | "web"
  | "plantilla"
  | "plugin"
  | "copia"
  | "aprobacion"
  | "mensaje"
  | "conocimiento"
  | "contacto"
  | "agenda"
  | "humano"
  | "redactar"
  | "segmentar"
  | "medir"
  | "imagen"
  | "velocidad"
  | "factura"
  | "dinero";

export type CapacidadAgente = {
  readonly icono: IconoCapacidad;
  readonly titulo: string;
  readonly detalle: string;
};

export type FichaCatalogo = {
  readonly slug: string;
  readonly nombre: string;
  readonly tagline: string | null;
  readonly descripcion: string | null;
  readonly categoria: string;
  readonly tipo: string;
  /**
   * La cara del agente. Sale del catálogo (`catalog_agents.avatar_url`) y, si
   * el cliente se la cambió a SU agente, de ahí: la elección es suya, y el
   * catálogo es global para todos los espacios.
   */
  readonly avatar: string | null;
  readonly herramientas: readonly { slug: string; nombre: string }[];
  /** Lo que sabe hacer, dicho como lo entiende un dueño de negocio. */
  readonly capacidades: readonly CapacidadAgente[];
  readonly creditosMensuales: number;
  readonly costeUsd: number;
  readonly creditosAlta: number;
  /** Ya contratado por este espacio. */
  readonly contratado: boolean;
  readonly agenteId: string | null;
  readonly conexiones: readonly ConexionRequerida[];
  readonly campos: readonly CampoPersonalizable[];
};

/**
 * Qué hace falta conectar antes de que cada agente sirva de algo.
 *
 * Se declara aquí y no en la base porque es conocimiento de producto sobre
 * PANTALLAS de esta aplicación (a dónde mandar al cliente a conectarlo), y una
 * ruta de Next no tiene por qué vivir en Postgres.
 */
const CONEXIONES_POR_AGENTE: Record<string, readonly { clave: string; nombre: string; descripcion: string; ruta: string }[]> =
  {
    webmaster: [
      {
        clave: "sitio",
        nombre: "Tu sitio web",
        descripcion: "La dirección que tiene que vigilar y mantener.",
        ruta: "/ajustes/sitio",
      },
    ],
    marketing: [
      {
        clave: "google_ads",
        nombre: "Google Ads",
        descripcion: "Para ver en qué se va tu inversión y proponerte cambios.",
        ruta: "/ajustes/canales",
      },
      {
        clave: "meta_ads",
        nombre: "Facebook e Instagram",
        descripcion: "Tus campañas de Meta, con el mismo criterio que las de Google.",
        ruta: "/ajustes/canales",
      },
      {
        clave: "analytics",
        nombre: "Google Analytics",
        descripcion: "Para saber qué hace la gente en tu web después de hacer clic.",
        ruta: "/ajustes/canales",
      },
      {
        clave: "conocimiento",
        nombre: "Conocimiento",
        descripcion: "Tu propuesta de valor y tus productos, para escribir con criterio.",
        ruta: "/conocimiento",
      },
    ],
    administrativo: [
      {
        clave: "contabilidad",
        nombre: "Alegra",
        descripcion: "Tu sistema de facturación: de ahí saca quién te debe y cuánto entró.",
        ruta: "/ajustes/contabilidad",
      },
    ],
    reportes: [
      {
        clave: "contabilidad",
        nombre: "Alegra",
        descripcion: "De ahí saca lo que entró, lo que salió y lo que te deben.",
        ruta: "/ajustes/contabilidad",
      },
    ],
    velocista: [
      {
        clave: "sitio",
        nombre: "Tu sitio web",
        descripcion: "La página que va a medir y acelerar.",
        ruta: "/ajustes/sitio",
      },
    ],
    disenador: [
      {
        clave: "sitio",
        nombre: "Tu sitio web",
        descripcion: "De ahí toma los colores de tu marca y ahí sube las imágenes.",
        ruta: "/ajustes/sitio",
      },
    ],
  };

/**
 * Qué sabe hacer cada agente, en palabras de negocio.
 *
 * Antes la ficha enseñaba `catalog_agents.required_tools`, que es la lista de
 * herramientas que el MOTOR exige conectadas, no lo que el agente hace. Por eso
 * el Webmaster —que edita la web, cambia plantillas y gestiona plugins— salía
 * con un único «Pasar a un humano». Lo que se promete al contratar es producto
 * y se declara aquí, junto a lo que necesita conectado.
 */
const CAPACIDADES_POR_AGENTE: Record<string, readonly CapacidadAgente[]> = {
  webmaster: [
    {
      icono: "web",
      titulo: "Cambia textos, páginas y entradas",
      detalle: "Le pides el cambio y lo hace él mismo en tu WordPress.",
    },
    {
      icono: "plantilla",
      titulo: "Edita el encabezado y el pie de página",
      detalle: "Enlaces, botones y textos de tus plantillas de Elementor.",
    },
    {
      icono: "plugin",
      titulo: "Gestiona tus plugins",
      detalle: "Activa, desactiva o elimina los que le indiques.",
    },
    {
      icono: "copia",
      titulo: "Hace copia antes de tocar nada",
      detalle: "Y te pide tu visto bueno en los cambios que se ven.",
    },
  ],
  marketing: [
    {
      icono: "medir",
      titulo: "Vigila en qué se va tu inversión",
      detalle: "Cuánto cuesta cada cliente que llega por Google, Facebook e Instagram.",
    },
    {
      icono: "segmentar",
      titulo: "Encuentra el dinero que se pierde",
      detalle: "Te dice qué campaña gasta sin traer clientes y cuál es la que mejor funciona.",
    },
    {
      icono: "aprobacion",
      titulo: "Propone y espera tu visto bueno",
      detalle: "Nunca mueve tu presupuesto sin que tú lo apruebes con un botón.",
    },
  ],
  disenador: [
    {
      icono: "imagen",
      titulo: "Te hace las imágenes que hacen falta",
      detalle: "Portadas de artículos, piezas para tus redes y cabeceras de páginas.",
    },
    {
      icono: "plantilla",
      titulo: "Usa los colores reales de tu marca",
      detalle: "Los mide de tu propia web, para que no parezcan de plantilla.",
    },
    {
      icono: "aprobacion",
      titulo: "Te las enseña antes de subirlas",
      detalle: "Y nunca reemplaza una imagen tuya sin que se lo pidas.",
    },
  ],
  velocista: [
    {
      icono: "velocidad",
      titulo: "Mide cuánto tarda tu web en abrir",
      detalle: "En celular y en computador, con la misma vara con la que la mide Google.",
    },
    {
      icono: "medir",
      titulo: "Te dice qué la está frenando",
      detalle: "Imágenes pesadas, falta de caché o el servidor, dicho sin tecnicismos.",
    },
    {
      icono: "copia",
      titulo: "Arregla y te enseña el antes y el después",
      detalle: "Activa la caché con tu permiso, hace copia y vuelve a medir.",
    },
  ],
  administrativo: [
    {
      icono: "dinero",
      titulo: "Te dice cuánto te deben y desde cuándo",
      detalle: "Ordenado por lo que más pesa, no por fecha: primero lo grande y viejo.",
    },
    {
      icono: "factura",
      titulo: "Emite facturas y registra pagos",
      detalle: "En tu sistema de facturación, y nunca sin tu visto bueno.",
    },
    {
      icono: "mensaje",
      titulo: "Prepara los recordatorios de cobro",
      detalle: "Escritos para cobrar sin ofender a un cliente que quieres conservar.",
    },
  ],
  reportes: [
    {
      icono: "medir",
      titulo: "Cómo va el negocio, en una página",
      detalle: "Cuánto entró, cuánto salió, qué te deben y qué vence esta semana.",
    },
    {
      icono: "segmentar",
      titulo: "Lo compara con el periodo anterior",
      detalle: "Para que el dato sea una noticia y no un número suelto.",
    },
    {
      icono: "aprobacion",
      titulo: "Solo mira: nunca toca tu contabilidad",
      detalle: "No emite, no cobra y no modifica nada. Solo te cuenta.",
    },
  ],
};

/**
 * Los bullets de un agente que todavía no tiene los suyos escritos a mano.
 *
 * El diccionario de arriba es la versión buena: está escrita en el idioma del
 * dueño del negocio. Pero un agente nuevo que nadie recuerde añadir ahí salía
 * con la tarjeta pelada, y eso fue exactamente lo que pasó con los cinco
 * agentes que entraron en septiembre de 2026. Su ficha ya trae sus objetivos
 * (`spec_template.goals`), así que de ahí sale un respaldo digno: no es tan
 * bueno como el texto a mano, pero nunca deja una tarjeta vacía.
 */
function capacidadesDeRespaldo(spec: unknown): readonly CapacidadAgente[] {
  const goals = (spec as { goals?: unknown } | null)?.goals;
  if (!Array.isArray(goals)) return [];
  return goals
    .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    .slice(0, 3)
    .map((g) => {
      const texto = g.trim();
      return {
        icono: "medir" as const,
        titulo: texto.charAt(0).toUpperCase() + texto.slice(1),
        detalle: "",
      };
    });
}

/**
 * Los 3-5 campos que se preguntan al contratar.
 *
 * Todo lo demás —nombre legal, horario, ciudad, tono, políticas— se HEREDA de
 * `company_profiles`, que se rellena una sola vez. Preguntar veinte campos por
 * agente es lo que hace que nadie termine de configurar ninguno.
 */
const CAMPOS_POR_AGENTE: Record<string, readonly CampoPersonalizable[]> = {
  webmaster: [
    {
      clave: "sitio",
      etiqueta: "Dirección del sitio",
      ayuda: "La página que va a vigilar.",
      tipo: "texto",
      valorPorDefecto: "",
    },
    {
      clave: "frecuencia",
      etiqueta: "Cada cuánto revisa",
      ayuda: "Con qué frecuencia comprueba que todo sigue en pie.",
      tipo: "opcion",
      opciones: [
        { valor: "1h", etiqueta: "Cada hora" },
        { valor: "6h", etiqueta: "Cada 6 horas" },
        { valor: "24h", etiqueta: "Una vez al día" },
      ],
      valorPorDefecto: "6h",
    },
    {
      clave: "avisar_a",
      etiqueta: "A quién avisa si algo se cae",
      ayuda: "Correo al que manda la alerta.",
      tipo: "texto",
      valorPorDefecto: "",
    },
  ],
  marketing: [
    {
      clave: "objetivo",
      etiqueta: "Objetivo de las campañas",
      ayuda: "Qué quieres conseguir con lo que escriba.",
      tipo: "opcion",
      opciones: [
        { valor: "captar", etiqueta: "Captar clientes nuevos" },
        { valor: "recuperar", etiqueta: "Recuperar clientes inactivos" },
        { valor: "fidelizar", etiqueta: "Fidelizar a los que ya compran" },
      ],
      valorPorDefecto: "captar",
    },
    {
      clave: "tono",
      etiqueta: "Tono",
      ayuda: "Cómo suena tu marca cuando escribe.",
      tipo: "opcion",
      opciones: [
        { valor: "cercano", etiqueta: "Cercano" },
        { valor: "neutro", etiqueta: "Neutro" },
        { valor: "formal", etiqueta: "Formal" },
      ],
      valorPorDefecto: "cercano",
    },
    {
      clave: "no_mencionar",
      etiqueta: "Qué no debe mencionar nunca",
      ayuda: "Temas, promesas o competidores que quedan fuera.",
      tipo: "parrafo",
      valorPorDefecto: "",
    },
  ],
};

export async function catalogoDelEspacio(workspaceId: string): Promise<FichaCatalogo[]> {
  return conEspacio(workspaceId, async (scope) => {
    const [catalogo, contratos, herramientas, canales, bases, sitios, contabilidades] =
      await Promise.all([
      scope.query<{
        slug: string;
        name: string;
        tagline: string | null;
        description: string | null;
        category: string;
        agent_type: string;
        avatar_url: string | null;
        spec_template: unknown;
        required_tools: string[];
        monthly_credits: number;
        setup_credits: number;
      }>(
        `select slug, name, tagline, description, category, agent_type,
                avatar_url, spec_template,
                required_tools, monthly_credits, setup_credits
           from public.catalog_agents
          where is_published
            -- En WhatsApp no se contratan agentes: los crea la persona con Strap.
            and agent_type <> 'conversational'
          order by position asc, name asc`,
        [],
      ),
      // La cara del agente contratado viene con el contrato: si el cliente se la
      // cambió, gana sobre la del catálogo, que es global y la ven todos.
      scope.query<{ catalog_slug: string; agent_id: string | null; status: string; avatar_url: string | null }>(
        `select s.catalog_slug, s.agent_id, s.status, a.avatar_url
           from public.agent_subscriptions s
           left join public.agents a
             on a.workspace_id = s.workspace_id and a.id = s.agent_id
          where s.workspace_id = $1 and s.status <> 'cancelled'`,
        [workspaceId],
      ),
      scope.query<{ slug: string; name: string }>(
        `select slug, name from public.tools where workspace_id is null or workspace_id = $1`,
        [workspaceId],
      ),
      scope.query<{ n: string }>(
        `select count(*)::text as n from public.channels
          where workspace_id = $1 and status = 'connected'`,
        [workspaceId],
      ),
      scope.query<{ n: string }>(
        `select count(*)::text as n from public.brains where workspace_id = $1`,
        [workspaceId],
      ),
      scope.query<{ n: string }>(
        `select count(*)::text as n from public.connections
          where workspace_id = $1 and provider = 'wordpress' and status = 'active'`,
        [workspaceId],
      ),
      scope.query<{ n: string }>(
        `select count(*)::text as n from public.connections
          where workspace_id = $1 and provider = 'alegra' and status = 'active'`,
        [workspaceId],
      ),
    ]);

    const nombreHerramienta = new Map(herramientas.rows.map((h) => [h.slug, h.name]));
    const contratados = new Map(contratos.rows.map((c) => [c.catalog_slug, c]));
    const listo: Record<string, boolean> = {
      whatsapp: Number(canales.rows[0]?.n ?? 0) > 0,
      conocimiento: Number(bases.rows[0]?.n ?? 0) > 0,
      // Listo cuando hay un WordPress con credenciales que ya se probaron: la
      // dirección sola, sin acceso, no le sirve de nada al Webmaster.
      sitio: Number(sitios.rows[0]?.n ?? 0) > 0,
      // Igual con la facturación: sin ella el agente financiero no tiene libros
      // que mirar, y más vale decirlo antes de contratarlo.
      contabilidad: Number(contabilidades.rows[0]?.n ?? 0) > 0,
    };

    return catalogo.rows.map((f) => {
      const contrato = contratados.get(f.slug);
      return {
        slug: f.slug,
        nombre: f.name,
        tagline: f.tagline,
        descripcion: f.description,
        categoria: f.category,
        tipo: f.agent_type,
        avatar: contrato?.avatar_url ?? f.avatar_url,
        herramientas: (f.required_tools ?? []).map((slug) => ({
          slug,
          nombre: nombreHerramienta.get(slug) ?? slug,
        })),
        capacidades: CAPACIDADES_POR_AGENTE[f.slug] ?? capacidadesDeRespaldo(f.spec_template),
        creditosMensuales: Number(f.monthly_credits ?? 0),
        costeUsd: creditosAUsd(Number(f.monthly_credits ?? 0)),
        creditosAlta: Number(f.setup_credits ?? 0),
        contratado: contrato !== undefined,
        agenteId: contrato?.agent_id ?? null,
        conexiones: (CONEXIONES_POR_AGENTE[f.slug] ?? []).map((c) => ({
          ...c,
          lista: listo[c.clave] ?? false,
        })),
        campos: CAMPOS_POR_AGENTE[f.slug] ?? [],
      };
    });
  });
}

export async function fichaDelCatalogo(workspaceId: string, slug: string): Promise<FichaCatalogo | null> {
  const catalogo = await catalogoDelEspacio(workspaceId);
  return catalogo.find((f) => f.slug === slug) ?? null;
}

export type ResultadoContratacion =
  | { readonly ok: true; readonly agenteId: string }
  | { readonly ok: false; readonly motivo: string };

/**
 * Contrata un agente del catálogo.
 *
 * El agente se crea en estado `draft` a propósito: el cuarto paso del asistente
 * es PROBARLO, y publicar antes de probar es exactamente lo que hace que un
 * agente mal configurado conteste a un cliente real.
 */
export async function contratarAgente(entrada: {
  workspaceId: string;
  usuarioId: string;
  slug: string;
  nombre: string;
  ajustes: Record<string, string>;
}): Promise<ResultadoContratacion> {
  return conEspacio(entrada.workspaceId, async (scope) => {
    const catalogo = await scope.query<{
      name: string;
      agent_type: string;
      description: string | null;
      tagline: string | null;
      spec_template: unknown;
    }>(
      `select name, agent_type, description, tagline, spec_template
         from public.catalog_agents where slug = $1 and is_published`,
      [entrada.slug],
    );
    const ficha = catalogo.rows[0];
    if (!ficha) return { ok: false, motivo: "Ese agente ya no está en el catálogo." };

    const yaEsta = await scope.query<{ id: string; agent_id: string | null }>(
      `select id, agent_id from public.agent_subscriptions
        where workspace_id = $1 and catalog_slug = $2 and status <> 'cancelled'`,
      [entrada.workspaceId, entrada.slug],
    );
    if (yaEsta.rows[0]?.agent_id) {
      return { ok: true, agenteId: yaEsta.rows[0].agent_id };
    }

    const creado = await scope.query<{ id: string }>(
      `insert into public.agents
         (workspace_id, kind, agent_type, catalog_slug, name, description, status, mode, created_by)
       values ($1, 'catalog', $2, $3, $4, $5, 'draft', 'lite', $6)
       returning id`,
      [
        entrada.workspaceId,
        ficha.agent_type,
        entrada.slug,
        entrada.nombre.trim() || ficha.name,
        ficha.description,
        entrada.usuarioId,
      ],
    );
    const agenteId = creado.rows[0]?.id;
    if (!agenteId) return { ok: false, motivo: "No se pudo crear el agente." };

    // Su ficha de instrucciones, traducida de la plantilla del catálogo.
    //
    // Va como BORRADOR y no como versión publicada a propósito: el agente nace
    // en `draft` porque el asistente todavía tiene que probarlo, y publicar
    // aquí lo pondría a trabajar antes de que nadie lo revise. El borrador es
    // exactamente lo que el constructor carga y el cliente puede editar.
    //
    // `do nothing` en el conflicto: recontratar a alguien no le borra lo que
    // el cliente había escrito la vez anterior.
    await scope.query(
      `insert into public.agent_drafts (workspace_id, agent_id, spec, phase, created_by)
       values ($1, $2, $3::jsonb, 'persona', $4)
       on conflict (workspace_id, agent_id) where agent_id is not null do nothing`,
      [
        entrada.workspaceId,
        agenteId,
        JSON.stringify(
          desdePlantillaDeCatalogo({
            nombre: entrada.nombre.trim() || ficha.name,
            descripcion: ficha.description,
            gancho: ficha.tagline,
            plantilla: ficha.spec_template,
          }),
        ),
        entrada.usuarioId,
      ],
    );

    await scope.query(
      `insert into public.agent_subscriptions
         (workspace_id, catalog_slug, agent_id, status, settings, created_by)
       values ($1, $2, $3, 'active', $4::jsonb, $5)
       on conflict (workspace_id, catalog_slug)
       do update set agent_id = excluded.agent_id,
                     status = 'active',
                     settings = excluded.settings,
                     cancelled_at = null`,
      [entrada.workspaceId, entrada.slug, agenteId, JSON.stringify(entrada.ajustes), entrada.usuarioId],
    );

    // Recontratar al Webmaster devuelve la vigilancia del sitio. El worker
    // también daría de alta los sitios que falten, pero esperar a su ronda
    // dejaría al cliente sin vigilancia durante minutos justo cuando acaba de
    // pedirla.
    if (entrada.slug === "webmaster") {
      await scope.query(
        `update public.site_monitor
            set activa = true, proxima_en = now(), updated_at = now()
          where workspace_id = $1 and not activa`,
        [entrada.workspaceId],
      );
    }

    // Recontratar devuelve el trabajo programado que se apagó al despedirlo.
    // SOLO ese: lo que el cliente pausó a mano sigue pausado, porque lo apagó
    // él y reactivárselo sin pedirlo sería empezar a gastarle créditos.
    // `proxima_en` no se toca: si quedó muy atrás, el worker se la salta y
    // programa la siguiente, que es lo que hace con cualquier atraso.
    await scope
      .query(
        `update public.agent_schedules
            set activa = true, motivo_pausa = null, updated_at = now()
          where workspace_id = $1 and agente = $2
            and not activa and motivo_pausa = 'agente_de_baja'`,
        [entrada.workspaceId, entrada.slug],
      )
      .catch(() => undefined);

    return { ok: true, agenteId };
  });
}

export type ResultadoBaja = { readonly ok: true } | { readonly ok: false; readonly motivo: string };

/**
 * Da de baja un agente contratado.
 *
 * Lo que se cancela es el CONTRATO, no el agente: sus instrucciones, su
 * conocimiento y su historial se quedan donde están, porque volver a
 * contratarlo es lo más normal del mundo y perder esa configuración sería
 * castigar al cliente por probar. El agente pasa a borrador para que deje de
 * atender, que es lo que el cliente espera al despedirlo.
 *
 * Y apaga la vigilancia del sitio si el que se va es el Webmaster: seguir
 * comprobando la web de alguien que ya no lo tiene contratado es trabajo que
 * nadie pidió y gasto que nadie paga.
 */
export async function cancelarAgente(entrada: {
  workspaceId: string;
  slug: string;
}): Promise<ResultadoBaja> {
  return conEspacio(entrada.workspaceId, async (scope) => {
    const contrato = await scope.query<{ agent_id: string | null }>(
      `update public.agent_subscriptions
          set status = 'cancelled', cancelled_at = now()
        where workspace_id = $1 and catalog_slug = $2 and status <> 'cancelled'
      returning agent_id`,
      [entrada.workspaceId, entrada.slug],
    );
    if (contrato.rows.length === 0) {
      return { ok: false, motivo: "Ese agente no está contratado en este espacio." };
    }

    const agenteId = contrato.rows[0]?.agent_id;
    if (agenteId) {
      await scope.query(
        `update public.agents set status = 'draft', updated_at = now()
          where workspace_id = $1 and id = $2`,
        [entrada.workspaceId, agenteId],
      );
    }

    if (entrada.slug === "webmaster") {
      await scope.query(
        `update public.site_monitor set activa = false, updated_at = now()
          where workspace_id = $1 and activa`,
        [entrada.workspaceId],
      );
    }

    // Y se calla su trabajo programado: seguir encargando en nombre de un
    // agente despedido es gasto que nadie pidió. Se apaga, no se borra, con el
    // motivo escrito, para poder devolverlo tal cual si lo recontratan.
    await scope
      .query(
        `update public.agent_schedules
            set activa = false, motivo_pausa = 'agente_de_baja', updated_at = now()
          where workspace_id = $1 and agente = $2 and activa`,
        [entrada.workspaceId, entrada.slug],
      )
      // Si la migración 0034 todavía no está aplicada, la tabla no existe: dar
      // de baja no puede fallar por eso.
      .catch(() => undefined);

    return { ok: true };
  });
}
