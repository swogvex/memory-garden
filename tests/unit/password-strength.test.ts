import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimatePasswordBits, passwordIssues, passwordLevel } from '@/features/access/setup-model';
import { checkPasswordPolicy, normalizeForList, type CommonPasswordData } from '@/lib/crypto';

/** Lista de contraseñas comunes (D-122) y medidor de fortaleza estimada. */
const DATA: CommonPasswordData = {
  long: new Set(['thequickbrownfox', 'iloveyousomuch!']),
  base: new Set(['barcelona', 'superman', 'princesa', 'contraseña']),
};

describe('política con la lista grande', () => {
  it('rechaza contraseñas largas conocidas aunque cambien mayúsculas, espacios o guiones', () => {
    for (const pw of ['The Quick Brown Fox', 'the-quick-brown-fox', 'THEQUICKBROWNFOX'])
      expect(checkPasswordPolicy(pw, DATA).reasons).toContain('common');
    expect(checkPasswordPolicy('The Quick Brown Fox').reasons).not.toContain('common'); // sin lista
  });

  it('rechaza una palabra común rodeada solo de números o símbolos', () => {
    for (const pw of ['barcelona12345', 'Superman!!!!!!', '2026Princesa2026', 'contraseña12345'])
      expect(checkPasswordPolicy(pw, DATA).reasons).toContain('common');
    // Si hay más palabras, ya no es «una palabra + relleno».
    expect(checkPasswordPolicy('barcelona y el mar azul', DATA).ok).toBe(true);
  });

  it('rechaza siempre una pieza repetida (también sin lista)', () => {
    for (const pw of ['teamoteamoteamo', 'abcabcabcabcabc', 'casa-casa-casa-casa'])
      expect(checkPasswordPolicy(pw).reasons).toContain('common');
  });

  it('passwordIssues usa la lista si se le da', () => {
    expect(passwordIssues('barcelona12345')).toEqual([]);
    expect(passwordIssues('barcelona12345', undefined, DATA)).toEqual(['common']);
  });
});

describe('medidor (estimación orientativa)', () => {
  it('una palabra con mayúscula, un año y un símbolo es «justa»', () => {
    expect(estimatePasswordBits('Mariaperez1985!')).toBeLessThan(50);
    expect(passwordLevel('Mariaperez1985!')).toBe(1);
  });
  it('una cadena aleatoria de 16 caracteres variados es «muy buena»', () => {
    expect(passwordLevel('Xk9#mQ2$vL7!pR4z')).toBe(3);
  });
  it('las secuencias y repeticiones casi no suman', () => {
    expect(estimatePasswordBits('jardin 123456789')).toBeLessThan(
      estimatePasswordBits('jardin 830574192'),
    );
    expect(estimatePasswordBits('nube nube nube nube')).toBeLessThan(30);
  });
  it('una palabra de la lista vale menos que una desconocida', () => {
    expect(estimatePasswordBits('princesa azulada', DATA)).toBeLessThan(
      estimatePasswordBits('princesa azulada'),
    );
  });
});

describe('script build-common-passwords', () => {
  /** Ejecuta el script de verdad (como lo hará la persona) sobre un archivo temporal y devuelve el módulo generado. */
  function generate(lines: string[], base: number): { long: string[]; base: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'mg-common-'));
    const input = join(dir, 'lista.txt');
    const out = join(dir, 'salida.ts');
    writeFileSync(input, lines.join('\n'), 'utf8');
    execFileSync(
      process.execPath,
      [
        'scripts/build-common-passwords.mjs',
        input,
        '--source',
        'prueba',
        '--license',
        'prueba',
        '--base',
        String(base),
        '--out',
        out,
      ],
      { stdio: 'pipe' },
    );
    const text = readFileSync(out, 'utf8');
    const list = (name: string) =>
      [
        ...(text.split(`export const ${name}: readonly string[] = [`)[1] ?? '')
          .split('];')[0]!
          .matchAll(/'([^']*)'/g),
      ].map((m) => m[1]!);
    return { long: list('COMMON_LONG'), base: list('COMMON_BASE') };
  }

  it('separa largas (≥ 14) y bases (4–13 letras), normaliza como la app, sin duplicados y en orden de frecuencia', () => {
    const letters = (n: number): string =>
      Array.from({ length: 3 }, (_, k) =>
        String.fromCharCode(97 + (Math.floor(n / 26 ** k) % 26)),
      ).join('');
    const filler = Array.from({ length: 1200 }, (_, i) => `jardin${letters(i)}`);
    const { long, base } = generate(
      [
        '123456',
        'password',
        'Barcelona',
        'barcelona',
        'iloveyou',
        'abc',
        'qwerty123',
        'The Quick-Brown_Fox',
        'thequickbrownfox',
        "it's-a-me-mario!!",
        '# comentario',
        ...filler,
      ],
      1100,
    );
    expect(base.slice(0, 3)).toEqual(['password', 'barcelona', 'iloveyou']); // en orden, sin números ni duplicados
    expect(base.length).toBe(1100);
    expect(long).toEqual(['thequickbrownfox']); // la de la comilla se descarta (el archivo generado es TS)
    expect(long[0]).toBe(normalizeForList('The Quick-Brown_Fox'));
  });

  it('se niega a escribir con una lista demasiado corta', () => {
    expect(() => generate(['password', 'barcelona'], 5000)).toThrow();
  });
});
