/**
 * Puerto del libro de créditos.
 *
 * La escritura real es una función SQL (otra corriente la implementa): resta
 * saldo y registra el asiento en la misma transacción, y descarta duplicados
 * por `idempotencyKey`. Aquí solo se define la forma del puerto y la lógica
 * de reserva previa, que sí es del motor.
 */

export type CreditEntryKind = "model" | "tool" | "channel" | "adjustment";

export type CreditEntry = {
  readonly workspaceId: string;
  readonly kind: CreditEntryKind;
  readonly credits: number;
  /** Clave estable de origen. Un reintento produce la misma y no cobra dos veces. */
  readonly idempotencyKey: string;
  /** Para auditoría: modelo, herramienta, tokens… Nunca credenciales. */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly agentRunId?: string;
  readonly conversationId?: string;
};

export type CreditChargeResult = {
  /** false cuando la clave ya existía: el cobro ya estaba hecho. */
  readonly applied: boolean;
  /** Saldo después del asiento. */
  readonly balance: number;
};

export type CreditReservation = {
  readonly id: string;
  readonly credits: number;
};

export interface CreditLedgerPort {
  /** Cobra de forma idempotente. Debe ser atómica en base de datos. */
  charge(entry: CreditEntry): Promise<CreditChargeResult>;
  balance(workspaceId: string): Promise<number>;
  /** Bloquea saldo antes de una operación cara. Devuelve null si no alcanza. */
  reserve?(input: {
    workspaceId: string;
    credits: number;
    idempotencyKey: string;
  }): Promise<CreditReservation | null>;
  /** Convierte la reserva en cobro definitivo con el consumo real. */
  settle?(input: { reservationId: string; credits: number }): Promise<CreditChargeResult>;
  /** Libera una reserva que no llegó a consumirse. */
  release?(reservationId: string): Promise<void>;
}

export type PrecheckOutcome =
  | { readonly ok: true; readonly balance: number; readonly reservation?: CreditReservation }
  | { readonly ok: false; readonly balance: number; readonly required: number; readonly reason: "sin_creditos" };

/**
 * Comprobación previa con reserva.
 *
 * Si el puerto sabe reservar, se reserva; si no, basta con comparar saldo.
 * Nunca se deja pasar una operación cara con el saldo justo: el turno se
 * abortaría a mitad y el cliente vería silencio.
 */
export async function precheckCredits(
  ledger: CreditLedgerPort,
  input: { workspaceId: string; estimatedCredits: number; idempotencyKey: string },
): Promise<PrecheckOutcome> {
  const required = Math.max(0, Math.ceil(input.estimatedCredits));
  const balance = await ledger.balance(input.workspaceId);

  if (balance < required) {
    return { ok: false, balance, required, reason: "sin_creditos" };
  }
  if (required === 0 || !ledger.reserve) {
    return { ok: true, balance };
  }

  const reservation = await ledger.reserve({
    workspaceId: input.workspaceId,
    credits: required,
    idempotencyKey: input.idempotencyKey,
  });
  if (!reservation) {
    return { ok: false, balance, required, reason: "sin_creditos" };
  }
  return { ok: true, balance, reservation };
}
