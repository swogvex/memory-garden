/**
 * H9.3 (D-260) · Medidor de Web Vitals en pantalla para medir en el iPhone sin Mac ni herramientas externas.
 *
 * Solo se carga si la URL lleva `?medir` (import dinámico desde AppShell): no pesa en la carga normal.
 * No guarda ni envía nada: lee la Performance API del propio navegador y pinta un recuadro.
 * Safari 26.2+ expone LCP y Event Timing (INP); CLS solo existe en Chromium y aquí sale «no disponible».
 * Son mediciones de UNA visita en UN dispositivo (laboratorio casero), no datos de campo ni garantías.
 */

interface ShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface EventEntry extends PerformanceEntry {
  interactionId?: number;
}

const ms = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)} ms`);

export function startVitalsOverlay(): void {
  if (document.getElementById('mg-vitals')) return;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const box = document.createElement('div');
  box.id = 'mg-vitals';
  box.setAttribute('aria-hidden', 'true'); // herramienta de medición: fuera del árbol accesible
  // Estilos por CSSOM: la CSP no permite <style> ni atributos style en línea, pero sí `style.setProperty`.
  const css: Record<string, string> = {
    position: 'fixed',
    left: '8px',
    bottom: 'calc(8px + env(safe-area-inset-bottom))',
    'z-index': '9999',
    padding: '6px 10px',
    'border-radius': '8px',
    background: 'rgb(55 49 63 / 88%)',
    color: '#fff',
    font: '12px/1.4 ui-monospace, Menlo, Consolas, monospace',
    'white-space': 'pre',
    'pointer-events': 'none',
  };
  for (const [k, v] of Object.entries(css)) box.style.setProperty(k, v);
  document.body.appendChild(box);

  let lcp: number | undefined;
  let inp: number | undefined;
  let cls: number | undefined;
  const interactions = new Map<number, number>();

  const render = () => {
    box.textContent = [
      `LCP ${supported.includes('largest-contentful-paint') ? ms(lcp) : 'no disponible'}`,
      `INP ${
        !supported.includes('event')
          ? 'no disponible'
          : interactions.size === 0
            ? '< 16 ms o sin interacciones' // la API solo informa de las que duran ≥ 16 ms
            : `${ms(inp)} (${interactions.size} lentas)`
      }`,
      `CLS ${supported.includes('layout-shift') ? (cls ?? 0).toFixed(3) : 'no disponible'}`,
      'solo en este dispositivo',
    ].join('\n');
  };

  if (supported.includes('largest-contentful-paint'))
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) lcp = last.startTime;
      render();
    }).observe({ type: 'largest-contentful-paint', buffered: true });

  if (supported.includes('event'))
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as EventEntry[]) {
        if (!e.interactionId) continue;
        interactions.set(
          e.interactionId,
          Math.max(interactions.get(e.interactionId) ?? 0, e.duration),
        );
      }
      // INP ≈ la interacción más lenta, ignorando una de cada 50 (como el algoritmo de web.dev).
      const sorted = [...interactions.values()].sort((a, b) => b - a);
      inp = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))];
      render();
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);

  if (supported.includes('layout-shift')) {
    // CLS por ventanas de sesión: saltos a menos de 1 s entre sí y ventana de 5 s como máximo; se queda la peor.
    let windowSum = 0;
    let windowStart = 0;
    let lastTime = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as ShiftEntry[]) {
        if (e.hadRecentInput) continue;
        if (e.startTime - lastTime > 1000 || e.startTime - windowStart > 5000) {
          windowSum = 0;
          windowStart = e.startTime;
        }
        windowSum += e.value;
        lastTime = e.startTime;
        cls = Math.max(cls ?? 0, windowSum);
      }
      render();
    }).observe({ type: 'layout-shift', buffered: true });
  }
  render();
}
