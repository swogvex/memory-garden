// Uso: node scripts/inspect-jpeg.mjs <archivo.jpg>
// Código de salida 0 = sin metadatos; 1 = hay metadatos o GPS; 2 = no es un JPEG.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Uso: node scripts/inspect-jpeg.mjs <archivo.jpg>');
  process.exit(2);
}
const b = readFileSync(path);
if (b[0] !== 0xff || b[1] !== 0xd8) {
  console.error('No es un JPEG.');
  process.exit(2);
}
let found = false;
let i = 2;
while (i < b.length && b[i] === 0xff) {
  while (b[i + 1] === 0xff) i++;
  const m = b[i + 1];
  if (m === undefined || m === 0xd9) break;
  const len = (b[i + 2] << 8) | b[i + 3];
  const head = b.subarray(i + 4, i + 4 + 28).toString('latin1');
  let note = '';
  if (m === 0xe1 && head.startsWith('Exif')) {
    note = 'EXIF';
    found = true;
    const hasGpsTag =
      b.subarray(i + 4, i + 2 + len).includes(Buffer.from([0x25, 0x88])) ||
      b.subarray(i + 4, i + 2 + len).includes(Buffer.from([0x88, 0x25]));
    if (hasGpsTag) note += ' (etiqueta GPS 0x8825 presente)';
  } else if (m === 0xe1) {
    note = 'APP1 (XMP u otro)';
    found = true;
  } else if (m === 0xfe || (m >= 0xe3 && m <= 0xef && m !== 0xee)) {
    note = 'metadatos';
    found = true;
  }
  console.log(`FF${m.toString(16).toUpperCase()}  ${String(len).padStart(6)} B  ${note}`);
  if (m === 0xda) break;
  i += 2 + len;
}
console.log(
  found
    ? 'RESULTADO: hay metadatos.'
    : 'RESULTADO: sin segmentos de metadatos (APP1, COM, APP3–15).',
);
process.exit(found ? 1 : 0);
