import { utf8, type Bytes } from './bytes';
import { hkdfSha256, hmacSha256 } from './hash';

/** Huella de IP temporal (sessions-and-limits.md §7.2, D-056). */
const IP_EPOCH_SECONDS = 6 * 3600;

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isV4(text: string): boolean {
  const m = V4.exec(text);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/**
 * IPv4: dirección completa. IPv6: prefijo /64 (los 4 primeros grupos, 4 dígitos hex cada uno).
 * IPv4 mapeada (::ffff:a.b.c.d) cuenta como IPv4. Todo lo ilegible cae en `unknown` (un cubo común y conservador).
 */
export function ipPrefix(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const ip = raw.trim().toLowerCase();
  if (isV4(ip)) return ip;
  if (!ip.includes(':') || ip.includes(':::')) return 'unknown';
  const mapped = /^(?:0{0,4}:){2,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1] && isV4(mapped[1])) return mapped[1];

  let text = ip;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail?.[1]) {
    if (!isV4(tail[1])) return 'unknown';
    const p = tail[1].split('.').map(Number);
    const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
    text =
      text.slice(0, text.length - tail[1].length) +
      hex(p[0] ?? 0, p[1] ?? 0) +
      ':' +
      hex(p[2] ?? 0, p[3] ?? 0);
  }
  const halves = text.split('::');
  if (halves.length > 2) return 'unknown';
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return 'unknown';
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return 'unknown';
  return groups
    .slice(0, 4)
    .map((g) => g.padStart(4, '0'))
    .join(':');
}

export function ipEpoch(now: number): number {
  return Math.floor(now / IP_EPOCH_SECONDS);
}

/** Primeros 8 bytes de HMAC-SHA256(K_ip, prefijo) en hex; K_ip = HKDF(PEPPER, "mg1/ip/<época>"). */
export async function ipFingerprint(
  pepper: Bytes,
  rawIp: string | null | undefined,
  epoch: number,
): Promise<string> {
  const key = await hkdfSha256(pepper, `mg1/ip/${epoch}`);
  const mac = await hmacSha256(key, utf8(ipPrefix(rawIp)));
  return Array.from(mac.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
