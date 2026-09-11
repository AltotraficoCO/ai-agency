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
  | "medir";

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
    recepcionista: [
      {
        clave: "whatsapp",
        nombre: "WhatsApp",
        descripcion: "Tu número de WhatsApp Business, para que pueda atender.",
        ruta: "/ajustes/canales",
      },
      {
        clave: "conocimiento",
        nombre: "Conocimiento",
        descripcion: "Lo que sabe de tu negocio: precios, horarios, preguntas frecuentes.",
        ruta: "/conocimiento",
      },
    ],
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
        clave: "conocimiento",
        nombre: "Conocimiento",
        descripcion: "Tu propuesta de valor y tus productos, para redactar con criterio.",
        ruta: "/conocimiento",
      },
      {
        clave: "whatsapp",
        nombre: "WhatsApp",
        descripcion: "Por dónde salen las campañas.",
        ruta: "/ajustes/canales",
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
  recepcionista: [
    {
      icono: "mensaje",
      titulo: "Responde a todo el que escribe",
      detalle: "A cualquier hora, por WhatsApp, con el tono de tu negocio.",
    },
    {
      icono: "conocimiento",
      titulo: "Resuelve dudas con tu información",
      detalle: "Precios, horarios y preguntas frecuentes, sin inventar.",
    },
    {
      icono: "contacto",
      titulo: "Toma los datos del interesado",
      detalle: "Nombre, teléfono y lo que busca, guardado en Contactos.",
    },
    {
      icono: "humano",
      titulo: "Te pasa la conversación cuando toca",
      detalle: "Si el cliente lo pide o hay una queja, avisa a tu equipo.",
    },
  ],
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
      icono: "redactar",
      titulo: "Redacta tus campañas",
      detalle: "Contenidos y mensajes listos para enviar, con tu tono.",
    },
    {
      icono: "segmentar",
      titulo: "Agrupa a tus contactos",
      detalle: "Por lo que aprendió de cada uno en las conversaciones.",
    },
    {
      icono: "medir",
      titulo: "Mide los resultados",
      detalle: "Te cuenta qué funcionó y qué conviene cambiar.",
    },
  ],
};

/**
 * Los 3-5 campos que se preguntan al contratar.
 *
 * Todo lo demás —nombre legal, horario, ciudad, tono, políticas— se HEREDA de
 * `company_profiles`, que se rellena una sola vez. Preguntar veinte campos por
 * agente es lo que hace que nadie termine de configurar ninguno.
 */
const CAMPOS_POR_AGENTE: Record<string, readonly CampoPersonalizable[]> = {
  recepcionista: [
    {
      clave: "nombre_agente",
      etiqueta: "Cómo se presenta",
      ayuda: "El nombre con el que saluda a tus clientes.",
      tipo: "texto",
      valorPorDefecto: "Recepción",
    },
    {
      clave: "saludo",
      etiqueta: "Primer mensaje",
      ayuda: "Lo primero que lee quien te escribe.",
      tipo: "parrafo",
      valorPorDefecto: "¡Hola! Soy el equipo de atención. ¿En qué te puedo ayudar?",
    },
    {
      clave: "escalar_cuando",
      etiqueta: "Cuándo pasar a una persona",
      ayuda: "En qué casos deja de responder y avisa a tu equipo.",
      tipo: "opcion",
      opciones: [
        { valor: "peticion", etiqueta: "Solo si el cliente lo pide" },
        { valor: "peticion_o_queja", etiqueta: "Si lo pide o si es una queja" },
        { valor: "siempre_venta", etiqueta: "Siempre que haya intención de compra" },
      ],
      valorPorDefecto: "peticion_o_queja",
    },
    {
      clave: "dato_clave",
      etiqueta: "Dato que siempre debe pedir",
      ayuda: "Lo que necesitas de cada interesado antes de cerrar la conversación.",
      tipo: "texto",
      valorPorDefecto: "Nombre y teléfono",
    },
  ],
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
    const [catalogo, contratos, herramientas, canales, bases, sitios] = await Promise.all([
      scope.query<{
        slug: string;
        name: string;
        tagline: string | null;
        description: string | null;
        category: string;
        agent_type: string;
        required_tools: string[];
        monthly_credits: number;
        setup_credits: number;
      }>(
        `select slug, name, tagline, description, category, agent_type,
                required_tools, monthly_credits, setup_credits
           from public.catalog_agents
          where is_published
          order by position asc, name asc`,
        [],
      ),
      scope.query<{ catalog_slug: string; agent_id: string | null; status: string }>(
        `select catalog_slug, agent_id, status
           from public.agent_subscriptions
          where workspace_id = $1 and status <> 'cancelled'`,
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
    ]);

    const nombreHerramienta = new Map(herramientas.rows.map((h) => [h.slug, h.name]));
    const contratados = new Map(contratos.rows.map((c) => [c.catalog_slug, c]));
    const listo: Record<string, boolean> = {
      whatsapp: Number(canales.rows[0]?.n ?? 0) > 0,
      conocimiento: Number(bases.rows[0]?.n ?? 0) > 0,
      // Listo cuando hay un WordPress con credenciales que ya se probaron: la
      // dirección sola, sin acceso, no le sirve de nada al Webmaster.
      sitio: Number(sitios.rows[0]?.n ?? 0) > 0,
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
        herramientas: (f.required_tools ?? []).map((slug) => ({
          slug,
          nombre: nombreHerramienta.get(slug) ?? slug,
        })),
        capacidades: CAPACIDADES_POR_AGENTE[f.slug] ?? [],
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
    const catalogo = await scope.query<{ name: string; agent_type: string; description: string | null }>(
      `select name, agent_type, description from public.catalog_agents where slug = $1 and is_published`,
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

    return { ok: true, agenteId };
  });
}
