import { describe, expect, it } from 'vitest';
import { createCountdown } from '@/features/access/countdown';

function fakeTimers() {
  let fn: (() => void) | null = null;
  return {
    setTimer: (f: () => void) => ((fn = f), 1),
    clearTimer: () => (fn = null),
    tick: () => fn?.(),
    active: () => fn !== null,
  };
}

describe('cuenta atrás', () => {
  it('avisa con los segundos que faltan y se detiene en 0', () => {
    const t = fakeTimers();
    const seen: number[] = [];
    const c = createCountdown((n) => seen.push(n), t);
    c.start(3);
    t.tick();
    t.tick();
    t.tick();
    expect(seen).toEqual([3, 2, 1, 0]);
    expect(t.active()).toBe(false);
  });

  it('0 segundos termina enseguida sin temporizador; `stop` lo cancela', () => {
    const t = fakeTimers();
    const seen: number[] = [];
    const c = createCountdown((n) => seen.push(n), t);
    c.start(0);
    expect(seen).toEqual([0]);
    expect(t.active()).toBe(false);
    c.start(5);
    c.stop();
    expect(t.active()).toBe(false);
  });

  it('un nuevo `start` reemplaza al anterior y redondea hacia arriba', () => {
    const t = fakeTimers();
    const seen: number[] = [];
    const c = createCountdown((n) => seen.push(n), t);
    c.start(10);
    c.start(1.2);
    expect(seen).toEqual([10, 2]);
  });
});
