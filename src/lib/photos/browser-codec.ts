import type { DecodedImage, DecodeHint, EncodedJpeg, ImageCodec } from './codec';
import { MAX_CANVAS_AREA } from './constants';
import { fitWithin } from './scale';
import type { Size } from './size';

async function drawJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<EncodedJpeg> {
  if (width * height > MAX_CANVAS_AREA) throw new Error('canvas-area');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-context');
    ctx.fillStyle = '#ffffff'; // el JPEG no tiene transparencia
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('canvas-encode');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
  } finally {
    canvas.width = 0; // libera la memoria del lienzo (Safari la retiene si no)
    canvas.height = 0;
  }
}

function fromBitmap(bitmap: ImageBitmap): DecodedImage {
  return {
    width: bitmap.width,
    height: bitmap.height,
    encodeJpeg: (w, h, q) => drawJpeg(bitmap, w, h, q),
    close: () => bitmap.close(),
  };
}

/** Plan A: reducir al decodificar (evita tener los 12–48 Mpx en memoria). Se valida el resultado. */
async function bitmapResized(file: Blob, target: Size): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  });
  // Si el navegador aplica la orientación en otro orden, el tamaño no coincide: se descarta.
  if (Math.abs(bitmap.width - target.width) > 1 || Math.abs(bitmap.height - target.height) > 1) {
    bitmap.close();
    throw new Error('resize-mismatch');
  }
  return fromBitmap(bitmap);
}

async function bitmapFull(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== 'function') throw new Error('no-createImageBitmap');
  return fromBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' }));
}

/** Plan B: `<img>` + `decode()` y dibujo en un lienzo ya reducido. */
async function loadImage(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image-load'));
      img.src = url;
    });
    await img.decode().catch(() => undefined);
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('image-empty');
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  img.onload = null;
  img.onerror = null;
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    encodeJpeg: (w, h, q) => drawJpeg(img, w, h, q),
    close: () => URL.revokeObjectURL(url),
  };
}

export function createBrowserCodec(): ImageCodec {
  return {
    async decode(file: Blob, hint: DecodeHint): Promise<DecodedImage> {
      const known = hint.displaySize;
      const target = known ? fitWithin(known.width, known.height, hint.maxSide) : null;
      const needsResize =
        known !== null &&
        target !== null &&
        (target.width !== known.width || target.height !== known.height);
      const attempts: Array<() => Promise<DecodedImage>> = [];
      if (needsResize && target && typeof createImageBitmap === 'function')
        attempts.push(() => bitmapResized(file, target));
      if (known && !needsResize)
        attempts.push(
          () => bitmapFull(file),
          () => loadImage(file),
        );
      else
        attempts.push(
          () => loadImage(file),
          () => bitmapFull(file),
        );
      let last: unknown;
      for (const attempt of attempts) {
        try {
          return await attempt();
        } catch (error) {
          last = error;
        }
      }
      throw last instanceof Error ? last : new Error('decode-failed');
    },
  };
}
