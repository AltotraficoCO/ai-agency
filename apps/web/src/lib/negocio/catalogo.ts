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
import { desdePlantillaDeCatalogo, type EspecificacionAgente } from "@strappy/db/spec";
import { conEspacio } from "@/lib/db/pool";
import { instruccionesDeAjustes } from "./ajustes-agente";
import { creditosAUsd } from "./planes";
import {
  CONTENIDO_POR_AGENTE,
  capacidadesDeRespaldo,
  type CampoPersonalizable,
  type CapacidadAgente,
  type ConexionDeclarada,
} from "./catalogo-contenido";

/**
 * Lo que el cliente LEE de cada agente —bullets, conexiones y preguntas— vive
 * en `catalogo-contenido.ts`, ordenado por agente. Se re-exporta desde aquí
 * para que las pantallas sigan entrando por la misma puerta.
 */
export type { CampoPersonalizable, CapacidadAgente, IconoCapacidad } from "./catalogo-contenido";

/** Una conexión declarada, más si este espacio ya la tiene lista. */
export type ConexionRequerida = ConexionDeclarada & {
  /** true si el espacio ya la tiene lista. */
  readonly lista: boolean;
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

export async function catalogoDelEspacio(workspaceId: string): Promise<FichaCatalogo[]> {
  return conEspacio(workspaceId, async (scope) => {
    const [catalogo, contratos, herramientas, canales, bases, conexiones] =
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
      // Todas las conexiones activas del espacio, por proveedor. Antes se
      // contaban solo WordPress y Alegra, y las de anuncios nunca salían
      // «listas» aunque estuvieran conectadas: el mismo patrón del diccionario
      // escrito a mano que ya nos mordió cuatro veces.
      scope.query<{ provider: string }>(
        `select distinct provider from public.connections
          where workspace_id = $1 and status = 'active'`,
        [workspaceId],
      ),
    ]);

    const nombreHerramienta = new Map(herramientas.rows.map((h) => [h.slug, h.name]));
    const contratados = new Map(contratos.rows.map((c) => [c.catalog_slug, c]));
    const activas = new Set(conexiones.rows.map((c) => c.provider));
    const listo: Record<string, boolean> = {
      // Cada proveedor conectado cuenta como listo bajo su propio nombre
      // (google_ads, meta_ads, tiktok_ads, ...): así una conexión nueva no
      // necesita que alguien se acuerde de añadirla aquí.
      ...Object.fromEntries([...activas].map((p) => [p, true])),
      whatsapp: Number(canales.rows[0]?.n ?? 0) > 0,
      conocimiento: Number(bases.rows[0]?.n ?? 0) > 0,
      // Listo cuando hay un WordPress con credenciales que ya se probaron: la
      // dirección sola, sin acceso, no le sirve de nada al Webmaster.
      sitio: activas.has("wordpress"),
      // Igual con la facturación: sin ella el agente financiero no tiene libros
      // que mirar, y más vale decirlo antes de contratarlo.
      contabilidad: activas.has("alegra"),
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
        capacidades: CONTENIDO_POR_AGENTE[f.slug]?.capacidades ?? capacidadesDeRespaldo(f.spec_template),
        creditosMensuales: Number(f.monthly_credits ?? 0),
        costeUsd: creditosAUsd(Number(f.monthly_credits ?? 0)),
        creditosAlta: Number(f.setup_credits ?? 0),
        contratado: contrato !== undefined,
        agenteId: contrato?.agent_id ?? null,
        conexiones: (CONTENIDO_POR_AGENTE[f.slug]?.conexiones ?? []).map((c) => ({
          ...c,
          lista: listo[c.clave] ?? false,
        })),
        campos: CONTENIDO_POR_AGENTE[f.slug]?.campos ?? [],
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
 * La ficha inicial, con lo que el cliente respondió en «Personaliza» escrito
 * dentro.
 *
 * Las respuestas se guardan también en `agent_subscriptions.settings`, que es
 * el contrato, pero ahí NADIE las lee: ningún adaptador del worker consulta ese
 * campo. Escribirlas en la ficha es lo que hace que el agente las cumpla, y de
 * paso el cliente las ve y las puede corregir en su pantalla de Instrucciones.
 */
function conAjustesDelCliente(
  slug: string,
  ajustes: Record<string, string>,
  ficha: EspecificacionAgente,
): EspecificacionAgente {
  const extra = instruccionesDeAjustes(slug, ajustes);
  if (extra.hace.length === 0 && extra.noHace.length === 0) return ficha;
  return {
    ...ficha,
    hace: [...ficha.hace, ...extra.hace],
    noHace: [...ficha.noHace, ...extra.noHace],
  };
}

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
        JSON.stringify(conAjustesDelCliente(entrada.slug, entrada.ajustes, desdePlantillaDeCatalogo({
          nombre: entrada.nombre.trim() || ficha.name,
          descripcion: ficha.description,
          gancho: ficha.tagline,
          plantilla: ficha.spec_template,
        }))),
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
