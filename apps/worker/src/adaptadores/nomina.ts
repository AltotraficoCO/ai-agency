/**
 * La nómina del espacio: qué agentes tiene contratados el cliente.
 *
 * Existe para que un agente pueda pedirle ayuda a otro. La condición es la que
 * pondría cualquier empresa: solo se le encarga trabajo a quien está en la
 * plantilla. Si el cliente no tiene contratado al de marketing, el Webmaster no
 * puede delegarle nada, por mucho que al modelo le parezca buena idea.
 *
 * El nombre que se devuelve es el que el cliente le puso a SU agente, no el del
 * catálogo: cuando el registro de trabajo diga «le pidió ayuda a Lucía», el
 * cliente tiene que reconocer a quién.
 */
import type { Companero } from "@strappy/agentes";
import type { SqlExecutor } from "../ports.js";

/**
 * Para qué sirve cada oficio, en una línea que el modelo pueda usar.
 *
 * Esta tabla decide además a QUIÉN se puede delegar: solo aparecen los oficios
 * que el worker sabe ejecutar hoy. El administrativo está contratado y se ve en
 * la web, pero todavía no tiene bucle aquí; ofrecerlo como compañero sería
 * invitar al modelo a delegar en alguien que no va a trabajar. Cuando entre su
 * bucle, se añade una línea y ya está.
 */
const PARA_QUE: Record<string, string> = {
  webmaster: "cuida la web: contenido, plugins, copias de seguridad y que no se caiga",
  marketing: "campañas de publicidad: qué funciona, qué se está desperdiciando y qué anunciar",
  administrativo:
    "las cuentas del negocio: cuánto le deben, qué facturas están vencidas y los recordatorios de cobro",
};

export class NominaPostgres {
  constructor(private readonly sql: SqlExecutor) {}

  /**
   * Los contratados del espacio, sin contar a quien pregunta.
   *
   * Se leen de `agent_subscriptions` (el contrato) y no de `agents`, porque lo
   * que decide si se le puede encargar trabajo a alguien es que esté
   * contratado, no que exista su ficha.
   */
  async companeros(input: {
    workspaceId: string;
    exceptoSlug: string;
  }): Promise<readonly Companero[]> {
    const { rows } = await this.sql.query<{ slug: string; nombre: string }>(
      `select s.catalog_slug as slug,
              coalesce(a.name, c.name, s.catalog_slug) as nombre
         from public.agent_subscriptions s
         left join public.agents a
           on a.id = s.agent_id and a.workspace_id = s.workspace_id
         left join public.catalog_agents c on c.slug = s.catalog_slug
        where s.workspace_id = $1
          and s.status = 'active'
          and s.catalog_slug <> $2
          -- Los de WhatsApp conversan con clientes finales: no reciben encargos
          -- de otro agente, los crea la persona y atienden su bandeja.
          and coalesce(c.agent_type, '') <> 'conversational'
        order by s.catalog_slug`,
      [input.workspaceId, input.exceptoSlug],
    );

    // El filtro está aquí y no en el SQL a propósito: quién sabe ejecutar cada
    // oficio es cosa del worker, no del esquema. Un contratado cuyo bucle
    // todavía no existe no se ofrece como compañero.
    return rows.flatMap((f) => {
      const paraQue = PARA_QUE[f.slug];
      return paraQue ? [{ slug: f.slug, nombre: f.nombre, paraQue }] : [];
    });
  }
}
