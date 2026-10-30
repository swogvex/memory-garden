/** Cuenta atrás en segundos (espera tras demasiados intentos). `onTick` recibe los segundos que faltan; 0 = terminó. */
export interface Countdown {
  start(seconds: number): void;
  stop(): void;
}

export function createCountdown(
  onTick: (remaining: number) => void,
  timers: {
    readonly setTimer?: (fn: () => void, ms: number) => unknown;
    readonly clearTimer?: (id: unknown) => void;
  } = {},
): Countdown {
  const setTimer = timers.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    timers.clearTimer ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  let id: unknown = null;
  let remaining = 0;
  const stop = () => {
    if (id !== null) clearTimer(id);
    id = null;
  };
  return {
    start(seconds) {
      stop();
      remaining = Math.max(0, Math.ceil(seconds));
      onTick(remaining);
      if (remaining === 0) return;
      id = setTimer(() => {
        remaining -= 1;
        onTick(remaining);
        if (remaining <= 0) stop();
      }, 1000);
    },
    stop,
  };
}
