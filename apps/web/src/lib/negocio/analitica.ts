import "server-only";

/**
 * «Tu consumo en Strappy»: conversaciones, rendimiento y créditos de IA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ESTE MÓDULO NUNCA HABLA DE DINERO DE META
 * ════════════════════════════════════════════════════════════════════════════
 * Lo que se lee aquí son CRÉDITOS que nosotros facturamos. El gasto de
 * mensajería de WhatsApp lo cobra Meta directamente al cliente y vive en
 * `meta.ts`, con otro tipo y sin ninguna función que los sume. Mezclarlos hace
 * que el cliente crea que le cobramos su factura de Meta, y esa confusión es la
 * primera causa de tickets en un modelo de Tech Provider.
 *
 * Todo sale de `usage_daily` (agregado diario) y no de recorrer `messages`: una
 * gráfica de 90 días sobre la tabla cruda no escala.
 */
import { conEspacio } from "@/lib/db/pool";
import { diasDelRango, periodoAnterior, type RangoDias } from "./fechas";

/** Marca de origen. Está en los tipos para que un `Gasto` de Meta no encaje. */
export const ORIGEN_STRAPPY = "strappy" as const;

export type PuntoAtencion = {
  readonly dia: string;
  /** Conversaciones que resolvió el agente sin intervención humana. */
  readonly ia: number;
  /** Conversaciones que acabaron en manos de una persona. */
  readonly humano: number;
};

export type Indicador = {
  readonly clave: string;
  readonly etiqueta: string;
  readonly valor: number;
  readonly anterior: number;
  /** Variación relativa contra el periodo anterior, o null si no había base. */
  readonly delta: number | null;
  readonly formato: "entero" | "duracion";
  /** Para el tiempo de respuesta, bajar es bueno. */
  readonly mejorEsMenor?: boolean;
  readonly explicacion: string;
};

export type Desenlace = { readonly clave: string; readonly etiqueta: string; readonly valor: number };

export type FilaRendimiento = {
  readonly agenteId: string | null;
  readonly nombre: string;
  readonly conversaciones: number;
  /** Fracción de conversaciones que el agente cerró sin escalar. */
  readonly tasaAutonomia: number;
  readonly tiempoMedioMs: number | null;
  readonly escalamientos: number;
  readonly creditos: number;
  /** Créditos por conversación. La cifra que decide si un agente sale a cuenta. */
  readonly costePorConversacion: number;
  /** Serie diaria de conversaciones, para el minigráfico de la fila. */
  readonly serie: readonly number[];
};

export type LineaConsumo = {
  readonly concepto: string;
  readonly etiqueta: string;
  readonly creditos: number;
  readonly explicacion: string;
};

export type SegmentoAgente = {
  readonly agenteId: string | null;
  readonly nombre: string;
  readonly creditos: number;
};

export type AnaliticaStrappy = {
  readonly origen: typeof ORIGEN_STRAPPY;
  readonly rango: RangoDias;
  readonly indicadores: readonly Indicador[];
  readonly atencion: readonly PuntoAtencion[];
  readonly desenlaces: readonly Desenlace[];
  readonly rendimiento: readonly FilaRendimiento[];
  readonly consumoPorConcepto: readonly LineaConsumo[];
  readonly consumoPorAgente: readonly SegmentoAgente[];
  readonly creditosDelRango: number;
};

type FilaUso = {
  dia: string;
  agent_id: string | null;
  agente: string | null;
  conversaciones: string;
  mensajes_in: string;
  mensajes_out: string;
  ejecuciones: string;
  escalamientos: string;
  creditos: string;
  latencia: string | null;
};

export async function analiticaDeStrappy(
  workspaceId: string,
  rango: RangoDias,
): Promise<AnaliticaStrappy> {
  const anterior = periodoAnterior(rango);

  return conEspacio(workspaceId, async (scope) => {
    const [uso, usoAnterior, contactos, contactosAnterior, desenlaces, conceptos, primeras, primerasAnterior] =
      await Promise.all([
        scope.query<FilaUso>(SQL_USO, [workspaceId, rango.desde, rango.hasta]),
        scope.query<FilaUso>(SQL_USO, [workspaceId, anterior.desde, anterior.hasta]),
        scope.query<{ n: string }>(SQL_CONTACTOS, [workspaceId, rango.desde, rango.hasta]),
        scope.query<{ n: string }>(SQL_CONTACTOS, [workspaceId, anterior.desde, anterior.hasta]),
        scope.query<{ resolution: string | null; n: string }>(SQL_DESENLACES, [
          workspaceId,
          rango.desde,
          rango.hasta,
        ]),
        scope.query<{ source: string; creditos: string }>(SQL_CONCEPTOS, [
          workspaceId,
          rango.desde,
          rango.hasta,
        ]),
        scope.query<{ ms: string | null }>(SQL_PRIMERA_RESPUESTA, [workspaceId, rango.desde, rango.hasta]),
        scope.query<{ ms: string | null }>(SQL_PRIMERA_RESPUESTA, [
          workspaceId,
          anterior.desde,
          anterior.hasta,
        ]),
      ]);

    const total = agregar(uso.rows);
    const totalAnterior = agregar(usoAnterior.rows);

    const indicadores: Indicador[] = [
      indicador({
        clave: "conversaciones",
        etiqueta: "Conversaciones",
        valor: total.conversaciones,
        anterior: totalAnterior.conversaciones,
        explicacion: "Hilos nuevos abiertos por un contacto en el periodo.",
      }),
      indicador({
        clave: "mensajes",
        etiqueta: "Mensajes",
        valor: total.mensajes,
        anterior: totalAnterior.mensajes,
        explicacion: "Recibidos y enviados, sumados.",
      }),
      indicador({
        clave: "contactos",
        etiqueta: "Contactos nuevos",
        valor: Number(contactos.rows[0]?.n ?? 0),
        anterior: Number(contactosAnterior.rows[0]?.n ?? 0),
        explicacion: "Personas que escribieron por primera vez.",
      }),
      indicador({
        clave: "primera_respuesta",
        etiqueta: "1.ª respuesta",
        valor: Number(primeras.rows[0]?.ms ?? 0),
        anterior: Number(primerasAnterior.rows[0]?.ms ?? 0),
        formato: "duracion",
        mejorEsMenor: true,
        explicacion: "Mediana de lo que tarda en salir la primera respuesta.",
      }),
    ];

    return {
      origen: ORIGEN_STRAPPY,
      rango,
      indicadores,
      atencion: serieDeAtencion(uso.rows, rango),
      desenlaces: desenlaces.rows.map((f) => ({
        clave: f.resolution ?? "sin_analizar",
        etiqueta: ETIQUETA_DESENLACE[f.resolution ?? "sin_analizar"] ?? "Sin analizar",
        valor: Number(f.n),
      })),
      rendimiento: rendimientoPorAgente(uso.rows, rango),
      consumoPorConcepto: conceptos.rows.map((f) => ({
        concepto: f.source,
        etiqueta: ETIQUETA_CONCEPTO[f.source]?.etiqueta ?? f.source,
        creditos: Number(f.creditos),
        explicacion: ETIQUETA_CONCEPTO[f.source]?.explicacion ?? "Consumo registrado por el motor.",
      })),
      consumoPorAgente: consumoPorAgente(uso.rows),
      creditosDelRango: total.creditos,
    };
  });
}

// ── SQL ─────────────────────────────────────────────────────────────────────
// `usage_daily` es el agregado que mantiene el motor. Se une a `agents` solo
// para poner nombre a la fila; el número nunca sale del join.
const SQL_USO = `
  select u.day::text as dia,
         u.agent_id,
         a.name as agente,
         u.conversations_started::text as conversaciones,
         u.messages_in::text  as mensajes_in,
         u.messages_out::text as mensajes_out,
         u.agent_runs::text   as ejecuciones,
         u.handovers::text    as escalamientos,
         u.credits_spent::text as creditos,
         u.avg_latency_ms::text as latencia
    from public.usage_daily u
    left join public.agents a on a.id = u.agent_id
   where u.workspace_id = $1 and u.day between $2::date and $3::date
   order by u.day asc`;

const SQL_CONTACTOS = `
  select count(*)::text as n
    from public.contacts
   where workspace_id = $1
     and created_at >= $2::date
     and created_at < ($3::date + 1)`;

const SQL_DESENLACES = `
  select a.resolution, count(*)::text as n
    from public.conversation_analysis a
   where a.workspace_id = $1
     and a.analyzed_at >= $2::date
     and a.analyzed_at < ($3::date + 1)
   group by a.resolution
   order by count(*) desc`;

const SQL_CONCEPTOS = `
  select source, coalesce(sum(amount), 0)::text as creditos
    from public.credit_ledger
   where workspace_id = $1
     and direction = 'debit'
     and created_at >= $2::date
     and created_at < ($3::date + 1)
   group by source
   order by sum(amount) desc`;

/**
 * Mediana, no media, del tiempo hasta la primera respuesta saliente.
 *
 * Una sola conversación olvidada un fin de semana desplaza la media varias
 * horas y hace que el indicador deje de significar nada. La mediana aguanta.
 */
const SQL_PRIMERA_RESPUESTA = `
  with primeras as (
    select c.id,
           min(m.created_at) filter (where m.direction = 'outbound') -
           min(m.created_at) filter (where m.direction = 'inbound') as espera
      from public.conversations c
      join public.messages m on m.conversation_id = c.id
     where c.workspace_id = $1
       and c.created_at >= $2::date
       and c.created_at < ($3::date + 1)
     group by c.id
  )
  select (extract(epoch from percentile_cont(0.5) within group (order by espera)) * 1000)::bigint::text as ms
    from primeras
   where espera is not null and espera >= interval '0'`;

// ── Agregación en memoria ───────────────────────────────────────────────────

function agregar(filas: readonly FilaUso[]) {
  let conversaciones = 0;
  let mensajes = 0;
  let creditos = 0;
  for (const f of filas) {
    conversaciones += Number(f.conversaciones);
    mensajes += Number(f.mensajes_in) + Number(f.mensajes_out);
    creditos += Number(f.creditos);
  }
  return { conversaciones, mensajes, creditos };
}

function indicador(entrada: {
  clave: string;
  etiqueta: string;
  valor: number;
  anterior: number;
  explicacion: string;
  formato?: Indicador["formato"];
  mejorEsMenor?: boolean;
}): Indicador {
  // Sin base anterior no hay porcentaje: «+∞ %» no informa de nada.
  const delta = entrada.anterior > 0 ? (entrada.valor - entrada.anterior) / entrada.anterior : null;
  return {
    clave: entrada.clave,
    etiqueta: entrada.etiqueta,
    valor: entrada.valor,
    anterior: entrada.anterior,
    delta,
    formato: entrada.formato ?? "entero",
    ...(entrada.mejorEsMenor ? { mejorEsMenor: true } : {}),
    explicacion: entrada.explicacion,
  };
}

/**
 * La serie IA vs. humano.
 *
 * `handovers` cuenta las conversaciones que pasaron a una persona; el resto las
 * cerró el agente solo. Es literalmente la métrica de negocio del producto: qué
 * porcentaje resuelve la IA sin ayuda.
 */
function serieDeAtencion(filas: readonly FilaUso[], rango: RangoDias): PuntoAtencion[] {
  const porDia = new Map<string, { ia: number; humano: number }>();
  for (const dia of diasDelRango(rango)) porDia.set(dia, { ia: 0, humano: 0 });

  for (const f of filas) {
    const punto = porDia.get(f.dia);
    if (!punto) continue;
    const conversaciones = Number(f.conversaciones);
    const humano = Math.min(conversaciones, Number(f.escalamientos));
    punto.humano += humano;
    punto.ia += Math.max(0, conversaciones - humano);
  }

  return [...porDia.entries()].map(([dia, v]) => ({ dia, ia: v.ia, humano: v.humano }));
}

function rendimientoPorAgente(filas: readonly FilaUso[], rango: RangoDias): FilaRendimiento[] {
  const dias = diasDelRango(rango);
  const indicePorDia = new Map(dias.map((d, i) => [d, i]));
  const acumulado = new Map<
    string,
    {
      agenteId: string | null;
      nombre: string;
      conversaciones: number;
      escalamientos: number;
      creditos: number;
      latencias: number[];
      serie: number[];
    }
  >();

  for (const f of filas) {
    const clave = f.agent_id ?? "sin_agente";
    const actual =
      acumulado.get(clave) ??
      {
        agenteId: f.agent_id,
        nombre: f.agente ?? "Sin agente asignado",
        conversaciones: 0,
        escalamientos: 0,
        creditos: 0,
        latencias: [] as number[],
        serie: new Array<number>(dias.length).fill(0),
      };
    actual.conversaciones += Number(f.conversaciones);
    actual.escalamientos += Number(f.escalamientos);
    actual.creditos += Number(f.creditos);
    if (f.latencia !== null) actual.latencias.push(Number(f.latencia));
    const i = indicePorDia.get(f.dia);
    if (i !== undefined) actual.serie[i] = (actual.serie[i] ?? 0) + Number(f.conversaciones);
    acumulado.set(clave, actual);
  }

  return [...acumulado.values()]
    .map((a) => ({
      agenteId: a.agenteId,
      nombre: a.nombre,
      conversaciones: a.conversaciones,
      tasaAutonomia:
        a.conversaciones > 0 ? Math.max(0, a.conversaciones - a.escalamientos) / a.conversaciones : 0,
      tiempoMedioMs:
        a.latencias.length > 0
          ? Math.round(a.latencias.reduce((s, v) => s + v, 0) / a.latencias.length)
          : null,
      escalamientos: a.escalamientos,
      creditos: a.creditos,
      costePorConversacion: a.conversaciones > 0 ? a.creditos / a.conversaciones : 0,
      serie: a.serie,
    }))
    .sort((x, y) => y.creditos - x.creditos);
}

function consumoPorAgente(filas: readonly FilaUso[]): SegmentoAgente[] {
  const acumulado = new Map<string, SegmentoAgente>();
  for (const f of filas) {
    const clave = f.agent_id ?? "sin_agente";
    const previo = acumulado.get(clave);
    acumulado.set(clave, {
      agenteId: f.agent_id,
      nombre: f.agente ?? "Sin agente asignado",
      creditos: (previo?.creditos ?? 0) + Number(f.creditos),
    });
  }
  return [...acumulado.values()].filter((s) => s.creditos > 0).sort((a, b) => b.creditos - a.creditos);
}

const ETIQUETA_DESENLACE: Record<string, string> = {
  resolved: "Resueltas por la IA",
  unresolved: "Sin resolver",
  escalated: "Pasadas a una persona",
  abandoned: "Abandonadas",
  sin_analizar: "Sin analizar",
};

const ETIQUETA_CONCEPTO: Record<string, { etiqueta: string; explicacion: string }> = {
  agent_run: {
    etiqueta: "Respuestas del agente",
    explicacion: "Lo que cuesta que la IA lea el hilo y redacte la respuesta.",
  },
  tool_run: {
    etiqueta: "Herramientas",
    explicacion: "Consultas a tu calendario, tu web o tus sistemas conectados.",
  },
  message_out: {
    etiqueta: "Mensajes enviados",
    explicacion:
      "Está a cero: la mensajería de WhatsApp te la cobra Meta directamente, nosotros no la revendemos.",
  },
  adjustment: { etiqueta: "Ajustes", explicacion: "Correcciones manuales aplicadas a tu cuenta." },
  topup: { etiqueta: "Recargas", explicacion: "Créditos que compraste. No caducan." },
};
