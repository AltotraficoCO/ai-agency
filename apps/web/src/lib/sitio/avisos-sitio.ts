import "server-only";

/**
 * Los avisos que el Webmaster deja al vigilar el sitio.
 *
 * Los escribe el worker (`apps/worker/src/consumers/vigilancia.ts`) cuando algo
 * CAMBIA: la web se cayó, volvió, el candado de seguridad está por vencer o se
 * perdió el acceso. Aquí solo se leen para enseñarlos donde vive el Webmaster.
 *
 * Se muestran los sin leer y como mucho los últimos días: un aviso de hace tres
 * semanas ya no es noticia, y la pantalla es para trabajar, no un archivo.
 */
import { conEspacio } from "@/lib/db/pool";

export type SeveridadAviso = "grave" | "aviso" | "bueno";

export type AvisoSitio = {
  readonly id: string;
  readonly severidad: SeveridadAviso;
  readonly titulo: string;
  readonly cuerpo: string;
  /** Qué se puede hacer. Null cuando no hay nada que proponer. */
  readonly propuesta: string | null;
  /** ISO 8601. */
  readonly creadoEl: string;
  readonly leido: boolean;
};

/** Cuántos días atrás se sigue enseñando un aviso ya leído. */
const DIAS_VISIBLES = 7;

export async function avisosDelSitio(workspaceId: string, limite = 5): Promise<AvisoSitio[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      severidad: string;
      titulo: string;
      cuerpo: string;
      propuesta: string | null;
      created_at: string;
      leido_en: string | null;
    }>(
      `select id, severidad, titulo, cuerpo, propuesta, created_at, leido_en
         from public.site_alerts
        where workspace_id = $1
          and (leido_en is null or created_at > now() - ($2::int * interval '1 day'))
        order by created_at desc
        limit $3`,
      [workspaceId, DIAS_VISIBLES, limite],
    );

    return rows.map((f) => ({
      id: f.id,
      severidad: severidadDe(f.severidad),
      titulo: f.titulo,
      cuerpo: f.cuerpo,
      propuesta: f.propuesta,
      creadoEl: f.created_at,
      leido: f.leido_en !== null,
    }));
  });
}

/** Marca un aviso como visto. Es lo único que el cliente escribe de esta tabla. */
export async function marcarAvisoLeido(workspaceId: string, avisoId: string): Promise<void> {
  await conEspacio(workspaceId, async (scope) => {
    await scope.query(
      `update public.site_alerts
          set leido_en = now()
        where workspace_id = $1 and id = $2 and leido_en is null`,
      [workspaceId, avisoId],
    );
  });
}

function severidadDe(valor: string): SeveridadAviso {
  return valor === "grave" || valor === "bueno" ? valor : "aviso";
}
