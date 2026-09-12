/**
 * Avisar al dueño del negocio por su propio WhatsApp.
 *
 * Pedro lo pidió con estas palabras: «que el Webmaster le mandó un mensaje: ey,
 * se nos cayó la red, ¿qué hacemos?». Es la diferencia entre una herramienta
 * que hay que ir a mirar y un empleado que te avisa.
 *
 * Tres cosas que mandan sobre el diseño:
 *
 *  · **Esto le cuesta dinero al cliente.** Meta le cobra a él cada
 *    conversación que abre su número. Por eso hay un tope por espacio y hora, y
 *    por eso este adaptador puede negarse a enviar y decir por qué, en vez de
 *    intentarlo pase lo que pase.
 *  · **Va siempre por plantilla aprobada.** Un aviso lo empieza el negocio, no
 *    el cliente, así que cae fuera de la ventana de 24 horas y WhatsApp solo
 *    deja retomar con una plantilla que Meta haya aprobado. Sin plantilla
 *    configurada no se envía: mandar texto libre sería un error garantizado.
 *  · **Que no salga el aviso no puede romper la vigilancia.** Cualquier fallo
 *    aquí se devuelve como «no enviado» con su motivo; el aviso ya quedó
 *    guardado y se ve en la web igualmente.
 */
import { descifrar } from "@strappy/db/adapters";
import { crearClienteWhatsApp } from "@strappy/whatsapp";
import type { MensajeriaPort, ResultadoEnvio, SqlExecutor } from "../ports.js";

/** Cómo configura el cliente a dónde quiere que le avisen. */
type ConfigAvisos = {
  /** Número en formato internacional, sin espacios ni signos. */
  readonly destino?: string;
  /** Nombre de la plantilla aprobada en Meta. */
  readonly plantilla?: string;
  /** Idioma de la plantilla, por ejemplo `es` o `es_CO`. */
  readonly idioma?: string;
};

/**
 * Tope de conversaciones abiertas por espacio y hora.
 *
 * Es una red, no una regla de negocio: la vigilancia ya avisa solo de cambios
 * de estado. Si algo se desboca —un sitio que parpadea, un error nuestro—, lo
 * paga el cliente, así que aquí se corta.
 */
const MAX_AVISOS_POR_HORA = 4;
const UNA_HORA_MS = 60 * 60 * 1000;

export class MensajeriaWhatsApp implements MensajeriaPort {
  readonly #enviados = new Map<string, number[]>();

  constructor(
    private readonly sql: SqlExecutor,
    private readonly claveMaestra: Buffer,
    private readonly opciones: {
      readonly fetch?: typeof globalThis.fetch;
      readonly ahora?: () => Date;
    } = {},
  ) {}

  async avisarAlDueno(input: {
    workspaceId: string;
    titulo: string;
    cuerpo: string;
    propuesta?: string;
  }): Promise<ResultadoEnvio> {
    const ahora = (this.opciones.ahora ?? (() => new Date()))().getTime();

    const config = await this.#config(input.workspaceId);
    if (!config?.destino) {
      return {
        enviado: false,
        motivo:
          "El espacio no tiene configurado un número al que avisar. El aviso queda guardado y se ve en Strappy.",
      };
    }
    if (!config.plantilla) {
      return {
        enviado: false,
        motivo:
          "Falta la plantilla aprobada de WhatsApp para avisos. Meta no deja iniciar una conversación sin ella.",
      };
    }

    if (!this.#cabeOtroAviso(input.workspaceId, ahora)) {
      return {
        enviado: false,
        motivo: `Ya se enviaron ${MAX_AVISOS_POR_HORA} avisos a este número en la última hora. Se deja de escribir para no gastarle conversaciones al cliente.`,
      };
    }

    const credenciales = await this.#credenciales(input.workspaceId);
    if (!credenciales) {
      return { enviado: false, motivo: "El espacio no tiene un número de WhatsApp conectado y activo." };
    }

    const api = crearClienteWhatsApp({
      accessToken: credenciales.token,
      ...(this.opciones.fetch ? { fetch: this.opciones.fetch } : {}),
    });

    // Dos variables: el qué y el qué hacer. La plantilla se aprueba una vez con
    // esa forma y sirve para cualquier aviso, hoy y el día que haya más.
    const detalle = [input.cuerpo, input.propuesta].filter(Boolean).join(" ");
    try {
      await api.enviarPlantilla({
        phoneNumberId: credenciales.phoneNumberId,
        to: config.destino,
        nombre: config.plantilla,
        idioma: config.idioma ?? "es",
        componentes: [
          {
            type: "body",
            parameters: [
              { type: "text", text: recortar(input.titulo, 250) },
              { type: "text", text: recortar(detalle, 600) },
            ],
          },
        ],
      });
      this.#anotarEnvio(input.workspaceId, ahora);
      return { enviado: true };
    } catch (error) {
      return {
        enviado: false,
        motivo: error instanceof Error ? error.message.slice(0, 300) : "No se pudo enviar el aviso.",
      };
    }
  }

  async #config(workspaceId: string): Promise<ConfigAvisos | null> {
    const { rows } = await this.sql.query<{ avisos: ConfigAvisos | null }>(
      `select settings #> '{avisos,whatsapp}' as avisos
         from public.workspaces where id = $1`,
      [workspaceId],
    );
    return rows[0]?.avisos ?? null;
  }

  /**
   * El número por defecto del espacio y el token de su cuenta.
   *
   * Se exige `status = 'active'`: un número en pausa o a medio registrar
   * devolvería un error de Meta que no dice nada útil al cliente.
   */
  async #credenciales(
    workspaceId: string,
  ): Promise<{ token: string; phoneNumberId: string } | null> {
    const { rows } = await this.sql.query<{
      token_cifrado: string | null;
      phone_number_id: string;
    }>(
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
      return {
        token: descifrar(fila.token_cifrado, this.claveMaestra),
        phoneNumberId: fila.phone_number_id,
      };
    } catch {
      // Clave rotada o fila tocada a mano: no es un error del aviso, es que hay
      // que reconectar WhatsApp. Se dice y se sigue.
      return null;
    }
  }

  #cabeOtroAviso(workspaceId: string, ahora: number): boolean {
    const recientes = (this.#enviados.get(workspaceId) ?? []).filter((t) => ahora - t < UNA_HORA_MS);
    this.#enviados.set(workspaceId, recientes);
    return recientes.length < MAX_AVISOS_POR_HORA;
  }

  #anotarEnvio(workspaceId: string, ahora: number): void {
    this.#enviados.set(workspaceId, [...(this.#enviados.get(workspaceId) ?? []), ahora]);
  }
}

function recortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1)}…`;
}
