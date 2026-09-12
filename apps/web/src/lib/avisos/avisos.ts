import "server-only";

/**
 * A dónde avisa el Webmaster cuando algo se rompe.
 *
 * La vigilancia del sitio ya decide CUÁNDO avisar y el worker ya sabe enviar
 * (`apps/worker/src/adaptadores/mensajeria.ts`). Lo que faltaba era esto: que
 * alguien pueda configurarlo. Sin número y sin plantilla el worker se niega a
 * enviar —correctamente—, así que la función estaba apagada para todos.
 *
 * Dos cosas mandan sobre el diseño:
 *
 *  · **El formato lo dicta el worker, no esta pantalla.** Lee
 *    `settings #> '{avisos,whatsapp}'` y espera `{destino, plantilla, idioma}`.
 *    Aquí se guarda exactamente eso; cualquier otra forma sería una pantalla que
 *    parece funcionar y un worker que nunca avisa.
 *  · **Cada aviso le cuesta dinero al cliente.** Meta le cobra a él la
 *    conversación que abre su número. Por eso se dice en la pantalla, y por eso
 *    existe el envío de prueba: para saber si funciona el día que se configura y
 *    no el día que se caiga la web.
 */
import { descifrar, leerClave } from "@strappy/db";
import { crearClienteWhatsApp } from "@strappy/whatsapp";
import { conEspacio, consultar } from "@/lib/db/pool";
import {
  IDIOMA_POR_DEFECTO,
  normalizarIdioma,
  normalizarNumero,
  normalizarPlantilla,
} from "./formato";

export type AvisosWhatsApp = {
  /** Número en formato internacional, sin espacios ni signos. */
  readonly destino: string;
  /** Nombre de la plantilla aprobada en Meta. */
  readonly plantilla: string;
  /** Idioma de la plantilla, por ejemplo `es` o `es_CO`. */
  readonly idioma: string;
  /** Apagados sin perder lo configurado. */
  readonly activo: boolean;
};

export type NumeroConectado = {
  /** Tal y como lo enseña Meta. */
  readonly numero: string;
  readonly nombre: string | null;
  /** Solo un número activo puede enviar. */
  readonly activo: boolean;
};

export type EstadoAvisos = {
  readonly config: AvisosWhatsApp | null;
  /** Los números del espacio, para ofrecerlos como destino. */
  readonly numeros: readonly NumeroConectado[];
  /** Si hay al menos un número activo con el que enviar. */
  readonly puedeEnviar: boolean;
};

/** Lo que hay guardado hoy y con qué se podría enviar. */
export async function estadoDeAvisos(workspaceId: string): Promise<EstadoAvisos> {
  return conEspacio(workspaceId, async (scope) => {
    const ajustes = await scope.query<{
      avisos: {
        destino?: string | null;
        destino_guardado?: string | null;
        plantilla?: string | null;
        idioma?: string | null;
        activo?: boolean | null;
      } | null;
    }>(
      `select settings #> '{avisos,whatsapp}' as avisos
         from public.workspaces where id = $1`,
      [workspaceId],
    );
    const guardado = ajustes.rows[0]?.avisos ?? null;

    const numeros = await scope.query<{ numero: string; nombre: string | null; estado: string }>(
      `select display_phone_number as numero, verified_name as nombre, status as estado
         from public.whatsapp_numbers
        where workspace_id = $1
        order by is_default desc, created_at`,
      [workspaceId],
    );

    const lista = numeros.rows.map((r) => ({
      numero: r.numero,
      nombre: r.nombre,
      activo: r.estado === "active",
    }));

    // Apagar deja `destino` en null para que el worker no escriba, pero la
    // pantalla tiene que seguir enseñando a quién se avisaría al encenderlo.
    const destino = guardado?.destino ?? guardado?.destino_guardado ?? null;

    return {
      config: destino
        ? {
            destino,
            plantilla: guardado?.plantilla ?? "",
            idioma: guardado?.idioma ?? IDIOMA_POR_DEFECTO,
            activo: Boolean(guardado?.destino),
          }
        : null,
      numeros: lista,
      puedeEnviar: lista.some((n) => n.activo),
    };
  });
}

export type ResultadoAvisos = { ok: true; mensaje: string } | { ok: false; error: string };

export async function guardarAvisos(input: {
  workspaceId: string;
  destino: string;
  plantilla: string;
  idioma: string;
  activo: boolean;
}): Promise<ResultadoAvisos> {
  const destino = normalizarNumero(input.destino);
  if (!destino) {
    return {
      ok: false,
      error:
        "Ese número no parece válido. Escríbelo con el indicativo del país, por ejemplo 573001234567.",
    };
  }
  const plantilla = normalizarPlantilla(input.plantilla);
  if (!plantilla) {
    return {
      ok: false,
      error:
        "El nombre de la plantilla va en minúsculas, sin espacios ni tildes, por ejemplo aviso_del_sitio.",
    };
  }
  const idioma = normalizarIdioma(input.idioma);
  if (!idioma) {
    return { ok: false, error: "El idioma se escribe como es o como es_CO." };
  }

  await escribirAvisos({
    workspaceId: input.workspaceId,
    destino,
    plantilla,
    idioma,
    activo: input.activo,
  });

  return {
    ok: true,
    mensaje: input.activo
      ? "Guardado. Si tu web se cae, el Webmaster te escribirá a ese número."
      : "Guardado y apagado: no se enviará ningún aviso hasta que los enciendas.",
  };
}

/**
 * Escribe dentro de `settings.avisos.whatsapp` sin pisar lo demás.
 *
 * Fusionar solo el primer nivel borraría cualquier otra clave de `avisos` el día
 * que haya avisos por correo, así que se fusiona también el de dentro.
 *
 * Va por la conexión transversal, como la tarifa de Impacto: `workspaces` no
 * admite escritura del rol acotado. Quien llama ya comprobó el papel.
 */
async function escribirAvisos(input: {
  workspaceId: string;
  destino: string;
  plantilla: string;
  idioma: string;
  activo: boolean;
}): Promise<void> {
  await consultar(
    `update public.workspaces
        set settings = settings || jsonb_build_object(
              'avisos',
              coalesce(settings->'avisos', '{}'::jsonb) || jsonb_build_object('whatsapp', $2::jsonb)
            ),
            updated_at = now()
      where id = $1`,
    [
      input.workspaceId,
      JSON.stringify({
        // Apagado es «sin destino»: el worker no conoce ninguna bandera, así que
        // dejarle el número puesto seguiría escribiéndole al cliente.
        destino: input.activo ? input.destino : null,
        destino_guardado: input.destino,
        plantilla: input.plantilla,
        idioma: input.idioma,
        activo: input.activo,
      }),
    ],
  );
}

/**
 * Manda un aviso de prueba al número configurado.
 *
 * Es la única forma de saber si la plantilla está bien antes de necesitarla de
 * verdad. Hace el mismo camino que el worker: número activo del espacio, token
 * descifrado y plantilla con dos variables, el qué y el qué hacer.
 */
export async function enviarAvisoDePrueba(input: {
  workspaceId: string;
  destino: string;
  plantilla: string;
  idioma: string;
}): Promise<ResultadoAvisos> {
  const destino = normalizarNumero(input.destino);
  const plantilla = normalizarPlantilla(input.plantilla);
  const idioma = normalizarIdioma(input.idioma);
  if (!destino || !plantilla || !idioma) {
    return { ok: false, error: "Completa el número y la plantilla antes de probar." };
  }

  const credenciales = await credencialesDeEnvio(input.workspaceId);
  if (!credenciales) {
    return {
      ok: false,
      error:
        "No hay ningún número de WhatsApp conectado y activo en este espacio. Conéctalo en Ajustes → Canales.",
    };
  }

  try {
    await crearClienteWhatsApp({ accessToken: credenciales.token }).enviarPlantilla({
      phoneNumberId: credenciales.phoneNumberId,
      to: destino,
      nombre: plantilla,
      idioma,
      componentes: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Prueba de aviso de Strappy" },
            {
              type: "text",
              text: "Si te llegó este mensaje, el Webmaster podrá avisarte cuando tu web tenga un problema.",
            },
          ],
        },
      ],
    });
  } catch (error) {
    return { ok: false, error: explicarFallo(error) };
  }

  return {
    ok: true,
    mensaje: `Enviado a ${destino}. Si no te llega en un minuto, revisa que la plantilla esté aprobada en Meta con ese nombre y ese idioma.`,
  };
}

/** El número por defecto y activo del espacio, con su token descifrado. */
async function credencialesDeEnvio(
  workspaceId: string,
): Promise<{ token: string; phoneNumberId: string } | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ token_cifrado: string | null; phone_number_id: string }>(
      `select a.access_token_encrypted as token_cifrado, n.phone_number_id
         from public.whatsapp_numbers n
         join public.whatsapp_accounts a
           on a.id = n.account_id and a.workspace_id = n.workspace_id
        where n.workspace_id = $1 and n.status = 'active'
        order by n.is_default desc
        limit 1`,
      [workspaceId],
    );
    const fila = rows[0];
    if (!fila?.token_cifrado) return null;
    try {
      // La MISMA clave con la que se cifró al conectar el canal
      // (`lib/canales/whatsapp.ts`): `ENCRYPTION_KEY`, no la del Webmaster.
      return {
        token: descifrar(fila.token_cifrado, leerClave(process.env.ENCRYPTION_KEY)),
        phoneNumberId: fila.phone_number_id,
      };
    } catch {
      return null;
    }
  });
}

/**
 * Meta contesta con códigos y textos en inglés. Lo que lee el cliente tiene que
 * decirle qué hacer, no repetirle el error del proveedor.
 */
function explicarFallo(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  if (/template/i.test(texto) && /not\s*(found|exist)/i.test(texto)) {
    return "Meta dice que esa plantilla no existe. Revisa que el nombre y el idioma sean exactamente los que aparecen en tu cuenta.";
  }
  if (/not\s*approved|pending/i.test(texto)) {
    return "Esa plantilla todavía no está aprobada por Meta. En cuanto la aprueben, vuelve a probar.";
  }
  if (/recipient|phone number/i.test(texto)) {
    return "Meta rechazó el número de destino. Compruébalo con indicativo de país y sin espacios.";
  }
  return `No se pudo enviar la prueba. Meta respondió: ${texto.slice(0, 200)}`;
}
