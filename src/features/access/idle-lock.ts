/**
 * Bloqueo por inactividad (sessions-and-limits.md §3): tras 30 min sin interacción se sueltan las claves.
 * El temporizador y el reloj son inyectables para probarlo sin esperar. Escribir en un formulario cuenta como actividad.
 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface IdleLockOptions {
  readonly timeoutMs?: number;
  readonly onIdle: () => void;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}

export interface IdleLock {
  /** Anota actividad. Barato: solo guarda la hora. */
  touch(): void;
  stop(): void;
}

export function startIdleLock(options: IdleLockOptions): IdleLock {
  const timeout = options.timeoutMs ?? IDLE_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let last = now();
  let stopped = false;
  let timer: unknown = null;

  const schedule = (ms: number) => {
    timer = setTimer(check, ms);
  };
  function check() {
    if (stopped) return;
    const idle = now() - last;
    if (idle >= timeout) {
      stopped = true;
      options.onIdle();
    } else {
      schedule(timeout - idle); // hubo actividad: espera solo lo que falta
    }
  }
  schedule(timeout);

  return {
    touch() {
      last = now();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
    },
  };
}
