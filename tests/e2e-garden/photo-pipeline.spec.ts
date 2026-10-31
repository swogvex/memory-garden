import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

interface Out {
  bytes: Uint8Array;
  width: number;
  height: number;
}
interface PhotosModule {
  createBrowserCodec(): unknown;
  processPhoto(file: Blob, codec: unknown): Promise<{ photo: Out; thumb: Out }>;
  processPhotos(
    files: Blob[],
    codec: unknown,
    o?: { onProgress?: (p: { index: number; stage: string }) => void },
  ): Promise<Array<{ ok: true; photo: { photo: Out } } | { ok: false; error: { code: string } }>>;
  isJpegMetadataFree(b: Uint8Array): boolean;
}
interface Scenario {
  kind: 'exif' | 'orientation' | 'garbage' | 'bad-jpeg' | 'five' | 'real';
  width?: number;
  height?: number;
  orientation?: number;
  realBase64?: string;
}
interface Report {
  photoW: number;
  photoH: number;
  thumbW: number;
  thumbH: number;
  free: boolean;
  inputHadSentinel: boolean;
  outputHasSentinel: boolean;
  outputHasExif: boolean;
  decodedW: number;
  decodedH: number;
  code: string | null;
  okCount: number;
  ms: number;
  outBase64: string;
}

async function loadModule(page: Page): Promise<void> {
  await page.goto('/404', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({
    type: 'module',
    content:
      "import * as a from '/src/lib/photos/index.ts'; import * as b from '/src/lib/photos/process.ts'; import * as c from '/src/lib/photos/jpeg.ts'; window.__photos = { ...a, ...b, ...c };",
  });
  await page.waitForFunction(() => '__photos' in window, undefined, { timeout: 90_000 });
}

function run(page: Page, scenario: Scenario): Promise<Report> {
  return page.evaluate(async (s) => {
    const mod = (window as unknown as { __photos: PhotosModule }).__photos;
    const codec = mod.createBrowserCodec();
    const SENTINEL = 'GPS-SENTINEL-41.38N';
    const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('');

    const canvasJpeg = async (w: number, h: number): Promise<Uint8Array> => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('ctx');
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#e58fa4');
      g.addColorStop(1, '#8fb0e3');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(w / 10, h / 10, w / 5, h / 5); // marca asimétrica para ver la orientación
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error('toBlob');
      return new Uint8Array(await blob.arrayBuffer());
    };
    const withExif = (jpeg: Uint8Array, orientation: number): Uint8Array => {
      const enc = new TextEncoder();
      const tiff = [
        0x49,
        0x49,
        0x2a,
        0,
        8,
        0,
        0,
        0,
        2,
        0,
        0x12,
        0x01,
        3,
        0,
        1,
        0,
        0,
        0,
        orientation,
        0,
        0,
        0,
        0x25,
        0x88,
        4,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ];
      const payload = [...enc.encode('Exif'), 0, 0, ...tiff, ...enc.encode(SENTINEL)];
      const len = payload.length + 2;
      const seg = Uint8Array.from([0xff, 0xe1, (len >> 8) & 255, len & 255, ...payload]);
      const out = new Uint8Array(jpeg.length + seg.length);
      out.set(jpeg.subarray(0, 2), 0);
      out.set(seg, 2);
      out.set(jpeg.subarray(2), 2 + seg.length);
      return out;
    };
    const toBlob = (b: Uint8Array) => new Blob([b.slice().buffer]);
    const b64 = (b: Uint8Array) => {
      let s2 = '';
      for (let i = 0; i < b.length; i += 8192)
        s2 += String.fromCharCode(...b.subarray(i, i + 8192));
      return btoa(s2);
    };
    const empty: Report = {
      photoW: 0,
      photoH: 0,
      thumbW: 0,
      thumbH: 0,
      free: false,
      inputHadSentinel: false,
      outputHasSentinel: false,
      outputHasExif: false,
      decodedW: 0,
      decodedH: 0,
      code: null,
      okCount: 0,
      ms: 0,
      outBase64: '',
    };
    const describeOutput = async (
      input: Uint8Array | null,
      out: { photo: Out; thumb: Out },
    ): Promise<Report> => {
      const bitmap = await createImageBitmap(toBlob(out.photo.bytes));
      const report: Report = {
        ...empty,
        photoW: out.photo.width,
        photoH: out.photo.height,
        thumbW: out.thumb.width,
        thumbH: out.thumb.height,
        free: mod.isJpegMetadataFree(out.photo.bytes) && mod.isJpegMetadataFree(out.thumb.bytes),
        inputHadSentinel: input ? latin1(input).includes(SENTINEL) : false,
        outputHasSentinel:
          latin1(out.photo.bytes).includes(SENTINEL) || latin1(out.thumb.bytes).includes(SENTINEL),
        outputHasExif:
          latin1(out.photo.bytes).includes('Exif') || latin1(out.thumb.bytes).includes('Exif'),
        decodedW: bitmap.width,
        decodedH: bitmap.height,
        outBase64: b64(out.photo.bytes),
      };
      bitmap.close();
      return report;
    };
    const failure = async (file: Blob): Promise<Report> => {
      try {
        await mod.processPhoto(file, codec);
        return { ...empty, code: 'ok' };
      } catch (e) {
        return { ...empty, code: (e as { code?: string }).code ?? 'otro' };
      }
    };

    const t0 = performance.now();
    if (s.kind === 'garbage')
      return failure(
        new Blob([new TextEncoder().encode('<svg><script>alert(1)</script></svg>')], {
          type: 'image/jpeg',
        }),
      );
    if (s.kind === 'bad-jpeg')
      return failure(
        new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 9, 9, 9, 9, 9, 9])], {
          type: 'image/jpeg',
        }),
      );
    if (s.kind === 'five') {
      const files: Blob[] = [];
      for (let i = 0; i < 5; i++) files.push(toBlob(withExif(await canvasJpeg(3000, 2000), 1)));
      const results = await mod.processPhotos(files, codec);
      const okCount = results.filter((r) => r.ok).length;
      return { ...empty, okCount, ms: performance.now() - t0 };
    }
    if (s.kind === 'real') {
      const bin = atob(s.realBase64 ?? '');
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const out = await mod.processPhoto(toBlob(bytes), codec);
      return { ...(await describeOutput(null, out)), ms: performance.now() - t0 };
    }
    const input = withExif(await canvasJpeg(s.width ?? 4000, s.height ?? 3000), s.orientation ?? 1);
    const out = await mod.processPhoto(toBlob(input), codec);
    return { ...(await describeOutput(input, out)), ms: performance.now() - t0 };
  }, scenario);
}

test.describe('tubería de fotos en el navegador (PS-39, PS-60 parcial)', () => {
  test.setTimeout(180_000);

  test('foto con Exif y GPS: sale a 2048 px, sin metadatos y decodificable', async ({
    page,
  }, testInfo) => {
    await loadModule(page);
    const r = await run(page, { kind: 'exif', width: 4000, height: 3000, orientation: 1 });
    expect(r.inputHadSentinel).toBe(true); // control
    expect(r.outputHasSentinel).toBe(false);
    expect(r.outputHasExif).toBe(false);
    expect(r.free).toBe(true);
    expect([r.photoW, r.photoH]).toEqual([2048, 1536]);
    expect(Math.max(r.thumbW, r.thumbH)).toBe(480);
    expect([r.decodedW, r.decodedH]).toEqual([2048, 1536]);
    const out = testInfo.outputPath(`photo-out-${testInfo.project.name}.jpg`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(r.outBase64, 'base64'));
  });

  test('orientación EXIF 6 con reducción: el resultado sale en vertical y con la proporción correcta', async ({
    page,
  }) => {
    await loadModule(page);
    const r = await run(page, { kind: 'orientation', width: 4000, height: 3000, orientation: 6 });
    expect(r.free).toBe(true);
    expect(r.photoH).toBeGreaterThan(r.photoW);
    expect(Math.abs(r.photoW / r.photoH - 3000 / 4000)).toBeLessThan(0.01);
    expect([r.decodedW, r.decodedH]).toEqual([r.photoW, r.photoH]);
  });

  test('orientación EXIF 6 sin reducción: sale en vertical', async ({ page }) => {
    await loadModule(page);
    const r = await run(page, { kind: 'orientation', width: 600, height: 400, orientation: 6 });
    expect([r.photoW, r.photoH]).toEqual([400, 600]);
  });

  test('un archivo .jpg que no es imagen se rechaza; un JPEG corrupto también', async ({
    page,
  }) => {
    await loadModule(page);
    expect((await run(page, { kind: 'garbage' })).code).toBe('unsupported_format');
    expect((await run(page, { kind: 'bad-jpeg' })).code).toBe('decode_failed');
  });

  test('cinco fotos de 6 Mpx seguidas se procesan', async ({ page }, testInfo) => {
    await loadModule(page);
    const r = await run(page, { kind: 'five' });
    expect(r.okCount).toBe(5);
    testInfo.annotations.push({ type: 'tiempo', description: `${Math.round(r.ms)} ms` });
  });

  test('foto real (opcional): define MG_TEST_PHOTO con la ruta de un JPEG con ubicación', async ({
    page,
  }, testInfo) => {
    const path = process.env['MG_TEST_PHOTO'];
    test.skip(!path, 'Sin MG_TEST_PHOTO');
    const input = readFileSync(path ?? '');
    await loadModule(page);
    const r = await run(page, { kind: 'real', realBase64: input.toString('base64') });
    const out = Buffer.from(r.outBase64, 'base64');
    expect(out.includes('Exif')).toBe(false);
    expect(r.free).toBe(true);
    expect(Math.max(r.photoW, r.photoH)).toBeLessThanOrEqual(2048);
    const file = testInfo.outputPath(`photo-real-out-${testInfo.project.name}.jpg`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out);
    testInfo.annotations.push({
      type: 'entrada con Exif',
      description: String(input.includes('Exif')),
    });
  });
});
