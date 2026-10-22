import { describe, expect, it } from 'vitest';
import { sniffImageKind } from '@/lib/photos/sniff';
import { ascii, concat } from './_photo-helpers';

describe('sniffImageKind (tipo real por contenido)', () => {
  it('reconoce JPEG, PNG, WebP y HEIC', () => {
    expect(sniffImageKind(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('jpeg');
    expect(sniffImageKind(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'png',
    );
    expect(sniffImageKind(concat(ascii('RIFF'), [1, 2, 3, 4], ascii('WEBPVP8 ')))).toBe('webp');
    for (const brand of ['heic', 'heix', 'mif1', 'heif'])
      expect(sniffImageKind(concat([0, 0, 0, 24], ascii('ftyp'), ascii(brand), [0, 0, 0, 0]))).toBe(
        'heic',
      );
  });

  it('rechaza lo que se hace pasar por imagen (extensión .jpg con otro contenido)', () => {
    const disguised: Array<[string, Uint8Array]> = [
      ['texto', Uint8Array.from(ascii('esto no es una imagen, solo texto'))],
      [
        'svg',
        Uint8Array.from(
          ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        ),
      ],
      ['gif', Uint8Array.from(ascii('GIF89a......'))],
      ['pdf', Uint8Array.from(ascii('%PDF-1.7 ......'))],
      ['zip', Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0)],
      ['mp4', concat([0, 0, 0, 24], ascii('ftyp'), ascii('isom'), [0, 0, 0, 0])],
      ['vacío', new Uint8Array(0)],
      ['jpeg truncado', Uint8Array.of(0xff, 0xd8)],
    ];
    for (const [, bytes] of disguised) expect(sniffImageKind(bytes)).toBeNull();
  });
});
