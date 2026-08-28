/**
 * `SchedulingPort` con el horario de la empresa.
 *
 * No hay integración con Google Calendar todavía y no se finge que la haya: los
 * huecos salen de `company_profiles.business_hours` y la cita queda registrada
 * como evento de la conversación. Es poco, pero es CIERTO, y el agente puede
 * decir «te agendé el martes a las 10» sabiendo que alguien lo va a ver en la
 * bandeja. Cuando entre el conector de agenda, se sustituye este adaptador sin
 * tocar la herramienta ni el motor.
 */
import type { SchedulingPort, SchedulingSlot } from '@strappy/tools';
import type { TenantScope } from '../client.js';

type HorarioDia = { desde: string; hasta: string };
type Horario = Partial<Record<string, HorarioDia[]>>;

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const;

const HORARIO_POR_DEFECTO: Horario = {
  lunes: [{ desde: '09:00', hasta: '17:00' }],
  martes: [{ desde: '09:00', hasta: '17:00' }],
  miercoles: [{ desde: '09:00', hasta: '17:00' }],
  jueves: [{ desde: '09:00', hasta: '17:00' }],
  viernes: [{ desde: '09:00', hasta: '17:00' }],
};

export function crearSchedulingPort(scope: TenantScope): SchedulingPort {
  const ws = scope.workspaceId;

  return {
    async availability({ workspaceId, fromISO, toISO, durationMinutes }) {
      scope.assertSameWorkspace(workspaceId);
      const horario = await leerHorario(scope, ws);
      const desde = new Date(fromISO);
      const hasta = new Date(toISO);
      const huecos: SchedulingSlot[] = [];

      const cursor = new Date(desde);
      cursor.setUTCHours(0, 0, 0, 0);

      // Tope de 14 días: una disponibilidad de tres meses no ayuda a nadie a
      // elegir y multiplica el prompt por nada.
      for (let dia = 0; dia < 14 && cursor <= hasta && huecos.length < 12; dia++) {
        const nombre = DIAS[cursor.getUTCDay()]!;
        for (const tramo of horario[nombre] ?? []) {
          const inicio = conHora(cursor, tramo.desde);
          const fin = conHora(cursor, tramo.hasta);
          for (
            let t = inicio.getTime();
            t + durationMinutes * 60_000 <= fin.getTime() && huecos.length < 12;
            t += durationMinutes * 60_000
          ) {
            if (t < desde.getTime() || t > hasta.getTime()) continue;
            huecos.push({
              startsAt: new Date(t).toISOString(),
              endsAt: new Date(t + durationMinutes * 60_000).toISOString(),
            });
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return huecos;
    },

    async book({ workspaceId, conversationId, startsAtISO, durationMinutes, title, attendeeName, attendeeEmail, notes }) {
      scope.assertSameWorkspace(workspaceId);
      const { rows } = await scope.query<{ id: string }>(
        `insert into public.conversation_events
           (workspace_id, conversation_id, type, actor_type, payload)
         values ($1, $2, 'cita_agendada', 'bot', $3::jsonb)
         returning id::text`,
        [
          ws,
          conversationId,
          JSON.stringify({
            inicio: startsAtISO,
            duracion_minutos: durationMinutes,
            titulo: title,
            nombre: attendeeName ?? null,
            correo: attendeeEmail ?? null,
            notas: notes ?? null,
          }),
        ],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('No se pudo registrar la cita.');

      await scope.query(
        `insert into public.notes (workspace_id, conversation_id, body)
         values ($1, $2, $3)`,
        [ws, conversationId, `Cita agendada: ${title} — ${startsAtISO}`],
      );

      return { eventId: id, startsAtISO };
    },
  };
}

/**
 * Los días llegan como los escribió la empresa: `miércoles` o `miercoles`, con
 * mayúscula o sin ella. Se normalizan al entrar en vez de exigir una grafía,
 * porque exigirla convierte una tilde en una cita que nunca se ofrece.
 */
function normalizarHorario(horario: Horario): Horario {
  const salida: Horario = {};
  for (const [dia, tramos] of Object.entries(horario)) {
    if (!Array.isArray(tramos)) continue;
    const clave = dia
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    salida[clave] = tramos;
  }
  return salida;
}

async function leerHorario(scope: TenantScope, ws: string): Promise<Horario> {
  const { rows } = await scope.query<{ business_hours: Horario | null }>(
    `select business_hours from public.company_profiles where workspace_id = $1`,
    [ws],
  );
  const horario = rows[0]?.business_hours;
  if (!horario || Object.keys(horario).length === 0) return HORARIO_POR_DEFECTO;
  return normalizarHorario(horario);
}

function conHora(dia: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':');
  const d = new Date(dia);
  d.setUTCHours(Number(h ?? 0), Number(m ?? 0), 0, 0);
  return d;
}
