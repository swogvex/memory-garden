import type { DecodedImage, ImageCodec } from './codec';
import {
  AVATAR_MAX_INPUT_BYTES,
  AVATAR_SPEC,
  HEADER_BYTES,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  PHOTO_MAX_SIDE,
  PHOTO_SPEC,
  THUMB_SPEC,
  type VariantSpec,
} from './constants';
import { PhotoError } from './errors';
import { isJpegMetadataFree, stripJpegMetadata } from './jpeg';
import { fitWithin } from './scale';
import { readDisplaySize } from './size';
import { sniffImageKind } from './sniff';

export interface EncodedImage {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}
export interface ProcessedPhoto {
  readonly photo: EncodedImage;
  readonly thumb: EncodedImage;
}
export type PhotoStage = 'reading' | 'photo' | 'thumbnail';

async function encodeOnce(
  image: DecodedImage,
  size: { width: number; height: number },
  quality: number,
): Promise<Uint8Array> {
  let raw;
  try {
    raw = await image.encodeJpeg(size.width, size.height, quality);
  } catch {
    throw new PhotoError('encode_failed');
  }
  if (raw.mime !== 'image/jpeg' || sniffImageKind(raw.bytes) !== 'jpeg')
    throw new PhotoError('encode_failed');
  const clean = stripJpegMetadata(raw.bytes);
  if (!isJpegMetadataFree(clean)) throw new PhotoError('encode_failed');
  return clean;
}

async function encodeVariant(image: DecodedImage, spec: VariantSpec): Promise<EncodedImage> {
  for (const side of spec.sides) {
    const size = fitWithin(image.width, image.height, side);
    for (const quality of spec.qualities) {
      const bytes = await encodeOnce(image, size, quality);
      if (bytes.length <= spec.maxBytes) return { bytes, width: size.width, height: size.height };
    }
  }
  throw new PhotoError('too_large');
}

/**
 * Una foto: tipo real → tamaño → decodificar → JPEG sin metadatos (foto y miniatura).
 * Lanza `PhotoError` con un código; nunca incluye datos del archivo en el error.
 */
export async function processPhoto(
  file: Blob,
  codec: ImageCodec,
  onStage?: (stage: PhotoStage) => void,
): Promise<ProcessedPhoto> {
  if (file.size === 0) throw new PhotoError('unsupported_format');
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('too_large');
  onStage?.('reading');
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const kind = sniffImageKind(head);
  if (!kind) throw new PhotoError('unsupported_format');
  const displaySize = readDisplaySize(head, kind);
  if (displaySize && displaySize.width * displaySize.height > MAX_INPUT_PIXELS)
    throw new PhotoError('too_large');

  let image: DecodedImage;
  try {
    image = await codec.decode(file, { kind, displaySize, maxSide: PHOTO_MAX_SIDE });
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError(kind === 'heic' ? 'unsupported_format' : 'decode_failed');
  }
  try {
    if (!(image.width >= 1 && image.height >= 1) || image.width * image.height > MAX_INPUT_PIXELS)
      throw new PhotoError('too_large');
    onStage?.('photo');
    const photo = await encodeVariant(image, PHOTO_SPEC);
    onStage?.('thumbnail');
    const thumb = await encodeVariant(image, THUMB_SPEC);
    return { photo, thumb };
  } finally {
    image.close();
  }
}

/**
 * Avatar: la misma tubería que una foto (tipo real por contenido, decodificar, JPEG nuevo sin metadatos) con
 * límites propios. Solo JPG, PNG o WEBP: un HEIC, un GIF o un archivo disfrazado se rechazan aunque el navegador los abriera.
 */
export async function processAvatar(file: Blob, codec: ImageCodec): Promise<EncodedImage> {
  if (file.size === 0) throw new PhotoError('unsupported_format');
  if (file.size > AVATAR_MAX_INPUT_BYTES) throw new PhotoError('too_large');
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const kind = sniffImageKind(head);
  if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp')
    throw new PhotoError('unsupported_format');
  const displaySize = readDisplaySize(head, kind);
  if (displaySize && displaySize.width * displaySize.height > MAX_INPUT_PIXELS)
    throw new PhotoError('too_large');

  let image: DecodedImage;
  try {
    image = await codec.decode(file, { kind, displaySize, maxSide: AVATAR_SPEC.sides[0] ?? 256 });
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('decode_failed');
  }
  try {
    if (!(image.width >= 1 && image.height >= 1) || image.width * image.height > MAX_INPUT_PIXELS)
      throw new PhotoError('too_large');
    return await encodeVariant(image, AVATAR_SPEC);
  } finally {
    image.close();
  }
}

export interface BatchProgress {
  readonly index: number;
  readonly total: number;
  readonly stage: PhotoStage | 'done' | 'failed';
}
export interface BatchOptions {
  readonly onProgress?: ((progress: BatchProgress) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}
export type PhotoResult =
  | { readonly ok: true; readonly photo: ProcessedPhoto }
  | { readonly ok: false; readonly error: PhotoError };

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * UNA FOTO A LA VEZ (memoria del móvil). Un fallo no detiene a las demás: cada resultado es
 * `ok` o `error`. Si se cancela, las pendientes devuelven `cancelled`.
 */
export async function processPhotos(
  files: readonly Blob[],
  codec: ImageCodec,
  options: BatchOptions = {},
): Promise<PhotoResult[]> {
  const total = files.length;
  const results: PhotoResult[] = [];
  for (const [index, file] of files.entries()) {
    if (options.signal?.aborted) {
      results.push({ ok: false, error: new PhotoError('cancelled') });
      continue;
    }
    try {
      const photo = await processPhoto(file, codec, (stage) =>
        options.onProgress?.({ index, total, stage }),
      );
      results.push({ ok: true, photo });
      options.onProgress?.({ index, total, stage: 'done' });
    } catch (error) {
      results.push({
        ok: false,
        error: error instanceof PhotoError ? error : new PhotoError('decode_failed'),
      });
      options.onProgress?.({ index, total, stage: 'failed' });
    }
    await yieldToEventLoop();
  }
  return results;
}
