/**
 * Cliente tipado de la Graph API de WhatsApp Cloud.
 *
 * Tres decisiones que conviene tener presentes:
 *  1. La versión de la API vive en UNA constante (`GRAPH_API_VERSION`, en
 *     `types.ts`). Meta deprecia versiones cada pocos meses y buscar cadenas
 *     "v23.0" repartidas por el código es cómo se rompe una integración.
 *  2. `fetch` se inyecta. Así los tests corren con respuestas grabadas y sin red.
 *  3. Cada error sale como `WhatsAppApiError` con la DECISIÓN ya tomada
 *     (reintentar, descartar, revocar token…). Quien llama no interpreta códigos.
 */
import {
  GRAPH_API_VERSION,
  GRAPH_BASE_URL,
  type ConversationAnalyticsRaw,
  type DebugTokenInfo,
  type MetaErrorBody,
  type MetaTemplate,
  type PhoneNumberInfo,
  type SendResult,
  type TemplateCategory,
  type TemplateComponent,
  type WabaInfo,
} from "./types.js";
import { WhatsAppApiError, decidirPorRespuesta } from "./errors.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type OpcionesCliente = {
  /** Token del cliente. Llega descifrado desde el runtime; nunca se persiste aquí. */
  accessToken: string;
  fetch?: FetchLike;
  /** Intentos totales, incluido el primero. */
  maxIntentos?: number;
  /** Retroceso base en ms; crece exponencialmente con jitter. */
  baseEsperaMs?: number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  /** URL base, sustituible en pruebas de integración. */
  baseUrl?: string;
};

export type PeticionGrafo = {
  method: "GET" | "POST" | "DELETE";
  /** Ruta relativa sin versión ni barra inicial, p.ej. `123/messages`. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Para subida de media: cuerpo multipart ya construido. */
  form?: FormData;
  /** Peticiones que no deben reintentarse aunque el error sea reintentable. */
  sinReintentos?: boolean;
};

export type ClienteWhatsApp = ReturnType<typeof crearClienteWhatsApp>;

export function crearClienteWhatsApp(opciones: OpcionesCliente) {
  const fetchImpl: FetchLike = opciones.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const maxIntentos = opciones.maxIntentos ?? 4;
  const baseEsperaMs = opciones.baseEsperaMs ?? 500;
  const dormir = opciones.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const aleatorio = opciones.aleatorio ?? Math.random;
  const baseUrl = opciones.baseUrl ?? GRAPH_BASE_URL;

  function construirUrl(path: string, query?: PeticionGrafo["query"]): string {
    const url = new URL(`${baseUrl}/${GRAPH_API_VERSION}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async function peticion<T>(req: PeticionGrafo): Promise<T> {
    const url = construirUrl(req.path, req.query);
    const intentos = req.sinReintentos ? 1 : maxIntentos;
    let ultimo: WhatsAppApiError | undefined;

    for (let intento = 1; intento <= intentos; intento++) {
      const init: RequestInit = {
        method: req.method,
        headers: {
          Authorization: `Bearer ${opciones.accessToken}`,
          ...(req.form ? {} : { "Content-Type": "application/json" }),
        },
      };
      if (req.form) init.body = req.form as unknown as RequestInit["body"];
      else if (req.body !== undefined) init.body = JSON.stringify(req.body);

      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, init);
      } catch (causa) {
        // Fallo de red: no hay cuerpo de Meta que interpretar, pero sí se reintenta.
        ultimo = new WhatsAppApiError({
          decision: {
            code: 0,
            accion: "reintentar",
            reintentar: true,
            marcarCuentaRevocada: false,
            pausarCola: false,
            mensajeUsuario: "No pudimos conectar con WhatsApp. Reintentando.",
          },
          httpStatus: 0,
          body: { causa: String(causa) },
        });
        if (intento < intentos) await esperar(intento, undefined);
        continue;
      }

      if (respuesta.ok) {
        const texto = await respuesta.text();
        return (texto ? JSON.parse(texto) : {}) as T;
      }

      const cuerpo = await leerJsonSeguro(respuesta);
      const decision = decidirPorRespuesta(cuerpo, respuesta.status);
      ultimo = new WhatsAppApiError({
        decision,
        httpStatus: respuesta.status,
        body: cuerpo,
        ...(((cuerpo as MetaErrorBody | null)?.error?.fbtrace_id !== undefined)
          ? { fbtraceId: (cuerpo as MetaErrorBody).error?.fbtrace_id as string }
          : {}),
      });

      if (!decision.reintentar || intento >= intentos) throw ultimo;
      const retryAfter = cabeceraRetryAfterMs(respuesta);
      await esperar(intento, retryAfter ?? decision.esperaSugeridaMs);
    }

    throw ultimo ?? new Error("Petición a WhatsApp sin respuesta.");
  }

  /** Retroceso exponencial con jitter completo, acotado a 60 s. */
  async function esperar(intento: number, minimoMs: number | undefined): Promise<void> {
    const exponencial = Math.min(60_000, baseEsperaMs * 2 ** (intento - 1));
    const conJitter = Math.round(exponencial * (0.5 + aleatorio() * 0.5));
    await dormir(Math.max(conJitter, minimoMs ?? 0));
  }

  // --- Mensajes -------------------------------------------------------------

  function sobreMensaje(to: string, extra: Record<string, unknown>) {
    return { messaging_product: "whatsapp", recipient_type: "individual", to, ...extra };
  }

  return {
    peticion,
    construirUrl,

    async enviarTexto(input: {
      phoneNumberId: string;
      to: string;
      text: string;
      previewUrl?: boolean;
      replyTo?: string;
    }): Promise<SendResult> {
      return peticion<SendResult>({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: sobreMensaje(input.to, {
          type: "text",
          text: { body: input.text, preview_url: input.previewUrl ?? false },
          ...(input.replyTo ? { context: { message_id: input.replyTo } } : {}),
        }),
      });
    },

    async enviarMedia(input: {
      phoneNumberId: string;
      to: string;
      tipo: "image" | "audio" | "video" | "document" | "sticker";
      /** Uno de los dos: id de media ya subida o enlace público. */
      mediaId?: string;
      link?: string;
      caption?: string;
      filename?: string;
      replyTo?: string;
    }): Promise<SendResult> {
      const media: Record<string, unknown> = {};
      if (input.mediaId) media.id = input.mediaId;
      if (input.link) media.link = input.link;
      // Meta rechaza caption en audio y sticker; se omite por tipo.
      if (input.caption && input.tipo !== "audio" && input.tipo !== "sticker") {
        media.caption = input.caption;
      }
      if (input.filename && input.tipo === "document") media.filename = input.filename;

      return peticion<SendResult>({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: sobreMensaje(input.to, {
          type: input.tipo,
          [input.tipo]: media,
          ...(input.replyTo ? { context: { message_id: input.replyTo } } : {}),
        }),
      });
    },

    async enviarInteractivo(input: {
      phoneNumberId: string;
      to: string;
      texto: string;
      botones?: { id: string; label: string }[];
      lista?: {
        boton: string;
        secciones: { title: string; rows: { id: string; title: string; description?: string }[] }[];
      };
      encabezado?: string;
      pie?: string;
      replyTo?: string;
    }): Promise<SendResult> {
      const comun = {
        ...(input.encabezado ? { header: { type: "text", text: input.encabezado } } : {}),
        body: { text: input.texto },
        ...(input.pie ? { footer: { text: input.pie } } : {}),
      };
      const interactive = input.lista
        ? {
            type: "list",
            ...comun,
            action: { button: input.lista.boton, sections: input.lista.secciones },
          }
        : {
            type: "button",
            ...comun,
            action: {
              buttons: (input.botones ?? []).map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.label },
              })),
            },
          };

      return peticion<SendResult>({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: sobreMensaje(input.to, {
          type: "interactive",
          interactive,
          ...(input.replyTo ? { context: { message_id: input.replyTo } } : {}),
        }),
      });
    },

    async enviarUbicacion(input: {
      phoneNumberId: string;
      to: string;
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }): Promise<SendResult> {
      return peticion<SendResult>({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: sobreMensaje(input.to, {
          type: "location",
          location: {
            latitude: input.latitude,
            longitude: input.longitude,
            ...(input.name ? { name: input.name } : {}),
            ...(input.address ? { address: input.address } : {}),
          },
        }),
      });
    },

    async enviarPlantilla(input: {
      phoneNumberId: string;
      to: string;
      nombre: string;
      idioma: string;
      componentes?: TemplateComponent[];
    }): Promise<SendResult> {
      return peticion<SendResult>({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: sobreMensaje(input.to, {
          type: "template",
          template: {
            name: input.nombre,
            language: { code: input.idioma },
            ...(input.componentes ? { components: input.componentes } : {}),
          },
        }),
      });
    },

    async marcarLeido(input: { phoneNumberId: string; messageId: string }): Promise<void> {
      await peticion({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: { messaging_product: "whatsapp", status: "read", message_id: input.messageId },
        // Un recibo de lectura tardío no vale nada: no se reintenta.
        sinReintentos: true,
      });
    },

    /**
     * Indicador de "escribiendo…". Meta lo acepta unido al recibo de lectura y
     * dura 25 s o hasta que se envía el mensaje; no hay forma de apagarlo.
     */
    async marcarEscribiendo(input: { phoneNumberId: string; messageId: string }): Promise<void> {
      await peticion({
        method: "POST",
        path: `${input.phoneNumberId}/messages`,
        body: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
          typing_indicator: { type: "text" },
        },
        sinReintentos: true,
      });
    },

    // --- Media --------------------------------------------------------------

    async subirMedia(input: {
      phoneNumberId: string;
      archivo: Blob;
      /** Debe coincidir con el tipo real; Meta valida el contenido. */
      mimeType: string;
      filename?: string;
    }): Promise<{ id?: string }> {
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.set("type", input.mimeType);
      form.set("file", input.archivo, input.filename ?? "archivo");
      return peticion<{ id?: string }>({
        method: "POST",
        path: `${input.phoneNumberId}/media`,
        form,
      });
    },

    /** Paso 1 de la descarga: Meta devuelve una URL firmada de corta vida. */
    async urlDeMedia(input: {
      mediaId: string;
      phoneNumberId?: string;
    }): Promise<{ url?: string; mime_type?: string; sha256?: string; file_size?: number }> {
      return peticion({
        method: "GET",
        path: input.mediaId,
        query: input.phoneNumberId ? { phone_number_id: input.phoneNumberId } : {},
      });
    },

    /**
     * Paso 2: la URL firmada exige la MISMA cabecera de autorización. Sin ella
     * Meta responde 401 aunque la URL parezca pública.
     */
    async descargarMedia(url: string): Promise<ArrayBuffer> {
      const respuesta = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${opciones.accessToken}` },
      });
      if (!respuesta.ok) {
        throw new WhatsAppApiError({
          decision: decidirPorRespuesta(await leerJsonSeguro(respuesta), respuesta.status),
          httpStatus: respuesta.status,
          body: null,
        });
      }
      return respuesta.arrayBuffer();
    },

    async borrarMedia(mediaId: string): Promise<{ success?: boolean }> {
      return peticion({ method: "DELETE", path: mediaId });
    },

    // --- Plantillas ---------------------------------------------------------

    async listarPlantillas(input: {
      wabaId: string;
      limite?: number;
      despues?: string;
    }): Promise<{ data?: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }> {
      return peticion({
        method: "GET",
        path: `${input.wabaId}/message_templates`,
        query: {
          limit: input.limite ?? 100,
          after: input.despues,
          fields: "id,name,status,category,language,components,quality_score,rejected_reason",
        },
      });
    },

    async crearPlantilla(input: {
      wabaId: string;
      nombre: string;
      idioma: string;
      categoria: TemplateCategory;
      componentes: unknown[];
    }): Promise<{ id?: string; status?: string; category?: string }> {
      return peticion({
        method: "POST",
        path: `${input.wabaId}/message_templates`,
        body: {
          name: input.nombre,
          language: input.idioma,
          category: input.categoria,
          components: input.componentes,
        },
      });
    },

    async borrarPlantilla(input: { wabaId: string; nombre: string }): Promise<{ success?: boolean }> {
      return peticion({
        method: "DELETE",
        path: `${input.wabaId}/message_templates`,
        query: { name: input.nombre },
      });
    },

    // --- Cuenta y números ---------------------------------------------------

    async leerWaba(wabaId: string): Promise<WabaInfo> {
      return peticion({
        method: "GET",
        path: wabaId,
        query: {
          fields:
            "id,name,currency,timezone_id,account_review_status,business_verification_status,message_template_namespace,primary_funding_id",
        },
      });
    },

    async listarNumeros(wabaId: string): Promise<{ data?: PhoneNumberInfo[] }> {
      return peticion({
        method: "GET",
        path: `${wabaId}/phone_numbers`,
        query: {
          fields:
            "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput,messaging_limit_tier",
        },
      });
    },

    async leerNumero(phoneNumberId: string): Promise<PhoneNumberInfo> {
      return peticion({
        method: "GET",
        path: phoneNumberId,
        query: {
          fields:
            "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput,messaging_limit_tier",
        },
      });
    },

    /** Registra el número en Cloud API con su PIN de verificación en dos pasos. */
    async registrarNumero(input: {
      phoneNumberId: string;
      pin: string;
    }): Promise<{ success?: boolean }> {
      return peticion({
        method: "POST",
        path: `${input.phoneNumberId}/register`,
        body: { messaging_product: "whatsapp", pin: input.pin },
      });
    },

    async darDeBajaNumero(phoneNumberId: string): Promise<{ success?: boolean }> {
      return peticion({ method: "POST", path: `${phoneNumberId}/deregister` });
    },

    /** Suscribe nuestra app a los webhooks de la WABA del cliente. */
    async suscribirApp(wabaId: string): Promise<{ success?: boolean }> {
      return peticion({ method: "POST", path: `${wabaId}/subscribed_apps` });
    },

    async listarAppsSuscritas(
      wabaId: string,
    ): Promise<{ data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[] }> {
      return peticion({ method: "GET", path: `${wabaId}/subscribed_apps` });
    },

    // --- Tokens -------------------------------------------------------------

    /**
     * Intercambia el `code` de Embedded Signup por el token del cliente.
     * Requiere las credenciales de NUESTRA app, no las del cliente.
     */
    async intercambiarCodigo(input: {
      appId: string;
      appSecret: string;
      code: string;
    }): Promise<{ access_token?: string; token_type?: string; expires_in?: number }> {
      return peticion({
        method: "GET",
        path: "oauth/access_token",
        query: {
          client_id: input.appId,
          client_secret: input.appSecret,
          code: input.code,
        },
        // Un `code` es de un solo uso: reintentar solo garantiza un segundo fallo.
        sinReintentos: true,
      });
    },

    /**
     * Inspecciona un token. `input_token` es el que se examina y `access_token`
     * el de la app (`appId|appSecret`), que es como Meta autoriza la consulta.
     */
    async depurarToken(input: {
      inputToken: string;
      appId: string;
      appSecret: string;
    }): Promise<DebugTokenInfo> {
      return peticion({
        method: "GET",
        path: "debug_token",
        query: { input_token: input.inputToken, access_token: `${input.appId}|${input.appSecret}` },
      });
    },

    // --- Analíticas ---------------------------------------------------------

    async analiticaConversaciones(input: {
      wabaId: string;
      /** Segundos epoch. */
      desde: number;
      hasta: number;
      granularidad: "HALF_HOUR" | "DAILY" | "MONTHLY";
      phoneNumbers?: string[];
      dimensiones?: string[];
    }): Promise<ConversationAnalyticsRaw> {
      const partes = [
        `start(${input.desde})`,
        `end(${input.hasta})`,
        `granularity(${input.granularidad})`,
        input.phoneNumbers?.length
          ? `phone_numbers(${JSON.stringify(input.phoneNumbers)})`
          : undefined,
        input.dimensiones?.length
          ? `dimensions(${JSON.stringify(input.dimensiones)})`
          : undefined,
      ].filter(Boolean);

      return peticion({
        method: "GET",
        path: input.wabaId,
        query: { fields: `conversation_analytics.${partes.join(".")}` },
      });
    },
  };
}

async function leerJsonSeguro(respuesta: Response): Promise<unknown> {
  try {
    const texto = await respuesta.text();
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

/** Meta usa `Retry-After` en segundos cuando limita por tasa. */
function cabeceraRetryAfterMs(respuesta: Response): number | undefined {
  const cabecera = respuesta.headers?.get?.("retry-after");
  if (!cabecera) return undefined;
  const segundos = Number(cabecera);
  return Number.isFinite(segundos) ? segundos * 1000 : undefined;
}
