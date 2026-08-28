/**
 * Debounce con cancelación.
 *
 * Una persona escribe "hola", "quería preguntar algo", "sobre el precio" en
 * tres segundos. Sin esto son tres ejecuciones del modelo, tres respuestas y
 * un agente que parece sordo. Con esto es una sola ejecución que ve los tres
 * mensajes.
 *
 * La clave es que el trabajo despierta y COMPRUEBA si sigue siendo el último.
 * Si mientras dormía llegó otro mensaje, se descarta sin hacer nada: no hay
 * forma de que dos ejecuciones del mismo hilo compitan.
 */

export type ScheduledEntry = {
  readonly token: string;
  readonly runAt: number;
};

/**
 * Dónde vive la programación vigente. En memoria para un proceso único; una
 * implementación con Redis o Postgres permite que el trabajo lo despierte
 * cualquier worker. El contrato es el mismo.
 */
export interface DebounceStore {
  schedule(key: string, entry: ScheduledEntry): Promise<void>;
  current(key: string): Promise<ScheduledEntry | null>;
  /** Borra solo si el token coincide, para no pisar una programación más nueva. */
  clear(key: string, token: string): Promise<void>;
}

export class InMemoryDebounceStore implements DebounceStore {
  readonly #entries = new Map<string, ScheduledEntry>();

  async schedule(key: string, entry: ScheduledEntry): Promise<void> {
    this.#entries.set(key, entry);
  }

  async current(key: string): Promise<ScheduledEntry | null> {
    return this.#entries.get(key) ?? null;
  }

  async clear(key: string, token: string): Promise<void> {
    if (this.#entries.get(key)?.token === token) this.#entries.delete(key);
  }
}

export type DebounceOutcome =
  | { readonly ran: true; readonly key: string; readonly token: string }
  | {
      readonly ran: false;
      readonly key: string;
      readonly token: string;
      /** `superseded`: llegó otro mensaje. `cancelled`: alguien canceló el hilo. */
      readonly reason: "superseded" | "cancelled";
    };

export interface TimerPort {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: TimerPort = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type DebouncerOptions = {
  store?: DebounceStore;
  /** Espera por defecto. Configurable por agente en cada `push`. */
  defaultDelayMs?: number;
  timers?: TimerPort;
  now?: () => number;
  newToken?: () => string;
  /** El trabajo real. Solo se llama si al despertar sigue siendo el último. */
  run: (input: { key: string; token: string; scheduledAt: number }) => Promise<void> | void;
  /** Se invoca siempre, haya trabajado o no. Útil para métricas. */
  onSettled?: (outcome: DebounceOutcome) => void;
};

export type Debouncer = {
  /** Programa (o reprograma) el hilo. `done` resuelve cuando ese intento acaba. */
  push(key: string, options?: { delayMs?: number }): { token: string; done: Promise<DebounceOutcome> };
  /** Cancela el hilo: el intento pendiente despertará y se descartará. */
  cancel(key: string): Promise<void>;
  pending(key: string): Promise<ScheduledEntry | null>;
};

export const DEFAULT_DEBOUNCE_MS = 6000;

export function createDebouncer(options: DebouncerOptions): Debouncer {
  const store = options.store ?? new InMemoryDebounceStore();
  const timers = options.timers ?? REAL_TIMERS;
  const now = options.now ?? (() => Date.now());
  const defaultDelayMs = options.defaultDelayMs ?? DEFAULT_DEBOUNCE_MS;
  const newToken = options.newToken ?? defaultTokenFactory();

  // Se guarda el intento en curso por clave: al reprogramar hay que apagar su
  // temporizador Y resolver su promesa, o quien esperaba ese `done` se queda
  // colgado para siempre.
  type Pendiente = { handle: unknown; token: string; settle: (o: DebounceOutcome) => void };
  const pendientes = new Map<string, Pendiente>();

  function descartar(key: string, reason: "superseded" | "cancelled"): void {
    const previo = pendientes.get(key);
    if (!previo) return;
    pendientes.delete(key);
    timers.clear(previo.handle);
    const outcome: DebounceOutcome = { ran: false, key, token: previo.token, reason };
    options.onSettled?.(outcome);
    previo.settle(outcome);
  }

  function push(key: string, opts?: { delayMs?: number }) {
    const delayMs = opts?.delayMs ?? defaultDelayMs;
    const token = newToken();
    const runAt = now() + delayMs;

    descartar(key, "superseded");

    let resolve!: (o: DebounceOutcome) => void;
    const done = new Promise<DebounceOutcome>((r) => {
      resolve = r;
    });

    const scheduled = store.schedule(key, { token, runAt });

    const handle = timers.set(() => {
      void (async () => {
        await scheduled;
        pendientes.delete(key);
        const outcome = await wake(store, key, token, async (entry) => {
          await options.run({ key, token, scheduledAt: entry.runAt });
        });
        options.onSettled?.(outcome);
        resolve(outcome);
      })();
    }, delayMs);
    pendientes.set(key, { handle, token, settle: resolve });

    return { token, done };
  }

  async function cancel(key: string): Promise<void> {
    const entry = await store.current(key);
    if (entry) await store.clear(key, entry.token);
    descartar(key, "cancelled");
  }

  return { push, cancel, pending: (key) => store.current(key) };
}

/**
 * La comprobación que hace que esto funcione, expuesta aparte para que un
 * worker distribuido (un job en cola que carga el token) use exactamente la
 * misma regla que el temporizador en memoria.
 */
export async function wake(
  store: DebounceStore,
  key: string,
  token: string,
  run: (entry: ScheduledEntry) => Promise<void>,
): Promise<DebounceOutcome> {
  const entry = await store.current(key);
  if (!entry) return { ran: false, key, token, reason: "cancelled" };
  if (entry.token !== token) return { ran: false, key, token, reason: "superseded" };

  // Se limpia ANTES de trabajar: si un mensaje llega durante la ejecución,
  // programará un token nuevo y tendrá su propio turno.
  await store.clear(key, token);
  await run(entry);
  return { ran: true, key, token };
}

function defaultTokenFactory(): () => string {
  let counter = 0;
  return () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
