import { CryptoError } from './errors';
import { MAX_CONTENT_BYTES, PAD_BUCKETS, PAD_PREFIX_BYTES } from './constants';
import type { Bytes } from './bytes';

/** length(4 B big-endian) || contenido || ceros hasta el siguiente cubo (§5.5). */
export function pad(content: Uint8Array): Bytes {
  if (content.length > MAX_CONTENT_BYTES) throw new CryptoError('payload_too_large');
  const total = PAD_PREFIX_BYTES + content.length;
  const bucket = PAD_BUCKETS.find((b) => b >= total);
  if (bucket === undefined) throw new CryptoError('payload_too_large');
  const out = new Uint8Array(bucket);
  new DataView(out.buffer).setUint32(0, content.length, false);
  out.set(content, PAD_PREFIX_BYTES);
  return out;
}

export function unpad(buf: Uint8Array): Bytes {
  if (!(PAD_BUCKETS as readonly number[]).includes(buf.length))
    throw new CryptoError('decrypt_failed');
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, false);
  if (PAD_PREFIX_BYTES + len > buf.length) throw new CryptoError('decrypt_failed');
  for (let i = PAD_PREFIX_BYTES + len; i < buf.length; i++) {
    if (buf[i] !== 0) throw new CryptoError('decrypt_failed');
  }
  return new Uint8Array(buf.subarray(PAD_PREFIX_BYTES, PAD_PREFIX_BYTES + len));
}
