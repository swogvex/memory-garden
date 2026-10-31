import { afterEach, describe, expect, it } from 'vitest';
import { saveFailureOf } from '@/features/calendar';
import { StorageError } from '@/lib/storage/errors';

/** El mensaje de un guardado fallido según la causa real (envuelta en `garden:save_failed`). */
const wrapped = (cause: unknown) => new Error('garden:save_failed', { cause });
const setOnline = (value: boolean) =>
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: value },
    configurable: true,
    writable: true,
  });
const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

describe('saveFailureOf', () => {
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  });

  it('cuota o archivo demasiado grande ⇒ `quota`; papelera remota ⇒ `remote_changed`; lo demás ⇒ `generic`', () => {
    setOnline(true);
    expect(saveFailureOf(wrapped(new StorageError('quota')))).toBe('quota');
    expect(saveFailureOf(wrapped(new StorageError('too_large')))).toBe('quota');
    expect(saveFailureOf(wrapped(new Error('garden:remote_changed')))).toBe('remote_changed');
    expect(saveFailureOf(wrapped(new StorageError('unavailable')))).toBe('generic');
    expect(saveFailureOf('raro')).toBe('generic');
  });

  it('sin conexión gana a cualquier otra causa', () => {
    setOnline(false);
    expect(saveFailureOf(wrapped(new StorageError('quota')))).toBe('offline');
  });
});
