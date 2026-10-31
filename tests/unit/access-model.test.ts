import { describe, expect, it } from 'vitest';
import { generateRecoveryKey } from '@/lib/crypto';
import {
  groupRecoveryInput,
  passwordIssues,
  passwordLevel,
  recoveryInputState,
  recoveryKeyFileName,
  recoveryKeyFileText,
} from '@/features/access/setup-model';
import { startIdleLock } from '@/features/access/idle-lock';

const key = () => generateRecoveryKey().display;

describe('contraseña', () => {
  it('detecta lo corto, lo común, lo poco variado y la falta de coincidencia', () => {
    expect(passwordIssues('corta')).toContain('too_short');
    expect(passwordIssues('memorygarden2026')).toContain('common');
    expect(passwordIssues('aaaaaaaaaaaaaaaa')).toContain('low_variety');
    expect(passwordIssues('una frase suficientemente larga')).toEqual([]);
    expect(passwordIssues('una frase suficientemente larga', 'otra cosa')).toEqual(['mismatch']);
    expect(
      passwordIssues('una frase suficientemente larga', 'una frase suficientemente larga'),
    ).toEqual([]);
  });

  it('el indicador estima la fortaleza (H8.2) y es 0 si no cumple la política', () => {
    expect(passwordLevel('corta')).toBe(0);
    expect(passwordLevel('memorygarden2026')).toBe(0);
    expect(passwordLevel('catorce letras!')).toBe(1);
    expect(passwordLevel('dieciocho caracteres')).toBe(1);
    expect(passwordLevel('una frase bastante larga')).toBe(2);
    expect(passwordLevel('lirio-cometa-baldosa-nube-trigo-farol')).toBe(3);
  });
});

describe('clave de recuperación tecleada', () => {
  it('vacía, incompleta, imposible, error de tecleo, distinta y correcta', () => {
    const k = key();
    expect(recoveryInputState('')).toBe('empty');
    expect(recoveryInputState(' - ')).toBe('empty');
    expect(recoveryInputState(k.slice(0, 10))).toBe('incomplete');
    expect(recoveryInputState(k + '1')).toBe('format');
    expect(recoveryInputState('U'.repeat(28))).toBe('format'); // la U no existe en el alfabeto
    const chars = k.replace(/-/g, '');
    const typo = (chars[0] === '2' ? '3' : '2') + chars.slice(1);
    expect(recoveryInputState(typo)).toBe('checksum');
    expect(recoveryInputState(k)).toBe('ok');
    expect(recoveryInputState(k.toLowerCase().replace(/-/g, ' '))).toBe('ok');
    expect(recoveryInputState(k, k)).toBe('ok');
    expect(recoveryInputState(k, key())).toBe('mismatch');
  });

  it('agrupa de 4 en 4 lo que se va escribiendo, con las equivalencias O→0 e I/L→1', () => {
    expect(groupRecoveryInput('abcd efgh-ij')).toBe('ABCD-EFGH-1J');
    expect(groupRecoveryInput('o')).toBe('0');
  });

  it('el archivo de texto lleva la clave y su advertencia, y nada más', () => {
    const k = key();
    const text = recoveryKeyFileText(k);
    expect(text).toContain(k);
    expect(text).toContain('nadie puede recuperarlos');
    expect(text).not.toMatch(/contraseña:/i);
  });

  it('H8.4: en inglés, el archivo y su nombre van en inglés', () => {
    const k = key();
    const text = recoveryKeyFileText(k, 'en');
    expect(text).toContain(k);
    expect(text).toContain('recovery key');
    expect(text).not.toMatch(/contraseña|recuperación/);
    expect(recoveryKeyFileName('en')).toBe('memory-garden-recovery-key.txt');
    expect(recoveryKeyFileName()).toBe('memory-garden-clave-de-recuperacion.txt');
  });
});

describe('bloqueo por inactividad', () => {
  function fake() {
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    return {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (t: unknown) =>
        void timers.splice(timers.indexOf(t as (typeof timers)[number]), 1),
      advance(ms: number) {
        now += ms;
        for (const t of [...timers]) {
          if (t.at <= now) {
            timers.splice(timers.indexOf(t), 1);
            t.fn();
          }
        }
      },
    };
  }

  it('bloquea tras el tiempo sin actividad y no antes', () => {
    const f = fake();
    let idle = 0;
    startIdleLock({ timeoutMs: 1000, onIdle: () => idle++, ...f });
    f.advance(999);
    expect(idle).toBe(0);
    f.advance(1);
    expect(idle).toBe(1);
  });

  it('la actividad retrasa el bloqueo, y el temporizador espera solo lo que falta', () => {
    const f = fake();
    let idle = 0;
    const lock = startIdleLock({ timeoutMs: 1000, onIdle: () => idle++, ...f });
    f.advance(600);
    lock.touch();
    f.advance(400); // llega el temporizador original, pero hubo actividad hace 400 ms
    expect(idle).toBe(0);
    f.advance(599);
    expect(idle).toBe(0);
    f.advance(1);
    expect(idle).toBe(1);
  });

  it('detenerlo cancela el bloqueo, y solo avisa una vez', () => {
    const f = fake();
    let idle = 0;
    const lock = startIdleLock({ timeoutMs: 1000, onIdle: () => idle++, ...f });
    lock.stop();
    f.advance(5000);
    expect(idle).toBe(0);
    const g = fake();
    startIdleLock({ timeoutMs: 1000, onIdle: () => idle++, ...g });
    g.advance(5000);
    g.advance(5000);
    expect(idle).toBe(1);
  });
});
