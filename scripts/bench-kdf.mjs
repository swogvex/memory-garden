// Mide cuánto tarda PBKDF2-HMAC-SHA256 (32 bytes) en ESTE equipo, con la Web Crypto de Node.
//   node scripts/bench-kdf.mjs                  (iteraciones por defecto, 5 repeticiones)
//   node scripts/bench-kdf.mjs 600000 1000000   (iteraciones concretas)
// OJO: el valor que decide `iter` es el del NAVEGADOR de la usuaria (otra implementación y otro hardware):
// usa tools/kdf-bench/index.html para eso. Este script sirve para tener un orden de magnitud en el PC de desarrollo.
import { cpus, platform, release } from 'node:os';

const RUNS = 5;
const iters = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0);
const list = iters.length > 0 ? iters : [100_000, 600_000, 1_000_000, 1_500_000, 2_000_000];

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const key = await subtle.importKey(
  'raw',
  enc.encode('contraseña de prueba de la medición'),
  'PBKDF2',
  false,
  ['deriveBits'],
);
const salt = crypto.getRandomValues(new Uint8Array(16));

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(
  `Node ${process.version} · ${platform()} ${release()} · ${cpus()[0]?.model ?? '?'} (${cpus().length} hilos)`,
);
console.log('iteraciones | mediana ms | mínimo | máximo');
await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 10_000 }, key, 256); // calentamiento
for (const iterations of list) {
  const t = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    t.push(performance.now() - t0);
  }
  console.log(
    `${String(iterations).padStart(11)} | ${median(t).toFixed(0).padStart(10)} | ${Math.min(...t)
      .toFixed(0)
      .padStart(6)} | ${Math.max(...t)
      .toFixed(0)
      .padStart(6)}`,
  );
}
