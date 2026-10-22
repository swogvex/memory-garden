import { describe, expect, it } from 'vitest';
import { es } from '@/lib/i18n/es';
import { MAX_ASSET_BYTES } from '@/lib/storage';
import { MAX_INPUT_BYTES } from '@/lib/photos/constants';
import { PhotoError, type PhotoErrorCode } from '@/lib/photos/errors';
import { isJpegMetadataFree } from '@/lib/photos/jpeg';
import { PHOTO_ERROR_MESSAGE } from '@/lib/photos/messages';
import { processPhoto, processPhotos, type BatchProgress } from '@/lib/photos/process';
import { ascii, blobOf, concat, fakeCodec, GPS_SENTINEL, latin1, makeJpeg } from './_photo-helpers';

const goodFile = () => blobOf(makeJpeg({ width: 4000, height: 3000 }));
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof PhotoError ? e.code : 'otro';
  }
};

describe('processPhoto', () => {
  it('produce foto 2048 px y miniatura 480 px, ambas JPEG sin metadatos', async () => {
    const { codec, state } = fakeCodec();
    const out = await processPhoto(goodFile(), codec);
    expect([out.photo.width, out.photo.height]).toEqual([2048, 1536]);
    expect([out.thumb.width, out.thumb.height]).toEqual([480, 360]);
    expect(isJpegMetadataFree(out.photo.bytes)).toBe(true);
    expect(isJpegMetadataFree(out.thumb.bytes)).toBe(true);
    expect(state.encodes[0]?.quality).toBe(0.82);
    expect(state.closes).toBe(1);
  });

  it('PS-39: aunque el códec devuelva Exif con GPS, la salida no lo lleva', async () => {
    const { codec } = fakeCodec({ exif: true });
    const out = await processPhoto(goodFile(), codec);
    for (const img of [out.photo, out.thumb]) {
      expect(latin1(img.bytes)).not.toContain(GPS_SENTINEL);
      expect(latin1(img.bytes)).not.toContain('Exif');
    }
  });

  it('baja la calidad hasta que cabe', async () => {
    const big = MAX_ASSET_BYTES.photo + 100_000;
    const { codec, state } = fakeCodec({ bytesFor: (_w, _h, q) => (q > 0.7 ? big : 1000) });
    const out = await processPhoto(goodFile(), codec);
    expect(state.encodes.slice(0, 2).map((e) => e.quality)).toEqual([0.82, 0.72]);
    expect(out.photo.bytes.length).toBeLessThanOrEqual(MAX_ASSET_BYTES.photo - 32);
  });

  it('si no cabe a 2048 px, reduce a 1600 px', async () => {
    const big = MAX_ASSET_BYTES.photo + 100_000;
    const { codec } = fakeCodec({ bytesFor: (w) => (w > 1600 ? big : 1000) });
    const out = await processPhoto(goodFile(), codec);
    expect(out.photo.width).toBe(1600);
  });

  it('too_large si nada cabe', async () => {
    const { codec } = fakeCodec({ bytesFor: () => MAX_ASSET_BYTES.photo + 1 });
    expect(await code(processPhoto(goodFile(), codec))).toBe('too_large');
  });

  it('encode_failed si el navegador no devuelve JPEG (Safari devuelve PNG)', async () => {
    expect(await code(processPhoto(goodFile(), fakeCodec({ mime: 'image/png' }).codec))).toBe(
      'encode_failed',
    );
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    expect(await code(processPhoto(goodFile(), fakeCodec({ encodeBytes: png }).codec))).toBe(
      'encode_failed',
    );
  });

  it('rechaza archivos disfrazados SIN llamar al decodificador', async () => {
    const files = [
      blobOf(Uint8Array.from(ascii('<svg><script>alert(1)</script></svg>'))),
      blobOf(Uint8Array.from(ascii('GIF89a......'))),
      blobOf(Uint8Array.from(ascii('%PDF-1.4'))),
      blobOf(new Uint8Array(0)),
    ];
    for (const f of files) {
      const { codec, state } = fakeCodec();
      expect(await code(processPhoto(f, codec))).toBe('unsupported_format');
      expect(state.decodes).toBe(0);
    }
  });

  it('rechaza archivos de más de 25 MiB sin decodificar', async () => {
    const { codec, state } = fakeCodec();
    const huge = blobOf(concat([0xff, 0xd8, 0xff], new Uint8Array(MAX_INPUT_BYTES)));
    expect(await code(processPhoto(huge, codec))).toBe('too_large');
    expect(state.decodes).toBe(0);
  });

  it('rechaza «bombas» de píxeles declarados sin decodificar (JPEG y PNG)', async () => {
    const { codec, state } = fakeCodec();
    expect(await code(processPhoto(blobOf(makeJpeg({ width: 20000, height: 20000 })), codec))).toBe(
      'too_large',
    );
    const png = concat(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13],
      ascii('IHDR'),
      [0, 0, 0x75, 0x30, 0, 0, 0x75, 0x30, 8, 6, 0, 0, 0],
    );
    expect(await code(processPhoto(blobOf(png), codec))).toBe('too_large');
    expect(state.decodes).toBe(0);
  });

  it('imagen corrupta: decode_failed; HEIC que no se abre: unsupported_format', async () => {
    const corrupt = fakeCodec({ decodeError: new Error('boom') });
    expect(await code(processPhoto(goodFile(), corrupt.codec))).toBe('decode_failed');
    const heic = blobOf(concat([0, 0, 0, 24], ascii('ftyp'), ascii('heic'), new Uint8Array(32)));
    expect(await code(processPhoto(heic, fakeCodec({ decodeError: new Error('x') }).codec))).toBe(
      'unsupported_format',
    );
  });

  it('libera la imagen aunque la codificación falle', async () => {
    const { codec, state } = fakeCodec({ mime: 'image/png' });
    await code(processPhoto(goodFile(), codec));
    expect(state.closes).toBe(1);
  });

  it('los errores no contienen datos del archivo', async () => {
    const f = blobOf(Uint8Array.from(ascii('secreto-personal')));
    try {
      await processPhoto(f, fakeCodec().codec);
    } catch (e) {
      expect((e as Error).message).toBe('photo:unsupported_format');
    }
  });
});

describe('processPhotos (una foto a la vez)', () => {
  it('procesa en serie y un fallo a mitad no detiene a las demás', async () => {
    const { codec, state } = fakeCodec();
    const events: BatchProgress[] = [];
    const bad = blobOf(Uint8Array.from(ascii('no soy una imagen')));
    const results = await processPhotos([goodFile(), bad, goodFile()], codec, {
      onProgress: (p) => events.push(p),
    });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]?.ok === false && results[1].error.code).toBe('unsupported_format');
    expect(state.maxActive).toBe(1);
    expect(events.filter((e) => e.index === 0).map((e) => e.stage)).toEqual([
      'reading',
      'photo',
      'thumbnail',
      'done',
    ]);
    expect(events.some((e) => e.index === 1 && e.stage === 'failed')).toBe(true);
  });

  it('cancelar marca el resto como cancelled', async () => {
    const { codec, state } = fakeCodec();
    const controller = new AbortController();
    const results = await processPhotos([goodFile(), goodFile(), goodFile()], codec, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage === 'done') controller.abort();
      },
    });
    expect(results.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual([
      'ok',
      'cancelled',
      'cancelled',
    ]);
    expect(state.decodes).toBe(1);
  });
});

describe('mensajes', () => {
  it('cada código tiene un mensaje que existe en es.ts', () => {
    const codes: PhotoErrorCode[] = [
      'unsupported_format',
      'too_large',
      'decode_failed',
      'encode_failed',
      'cancelled',
    ];
    for (const c of codes) expect(es).toHaveProperty(PHOTO_ERROR_MESSAGE[c]);
  });
});
