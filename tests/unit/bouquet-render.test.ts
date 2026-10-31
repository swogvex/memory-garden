import { describe, expect, it } from 'vitest';
import { FLOWER_IDS, makeRng } from '@/lib/flowers';
import {
  composeBouquet,
  renderBouquet,
  type BouquetLayout,
  type BouquetMemory,
  type RenderOptions,
} from '@/features/bouquets';

function memories(n: number, photos = 0): BouquetMemory[] {
  const rng = makeRng(`r-${n}`);
  return Array.from({ length: n }, (_, i) => ({
    id: `r-${n}-${String(i).padStart(3, '0')}`,
    date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
    flower: FLOWER_IDS[Math.floor(rng() * FLOWER_IDS.length)] ?? 'rosa',
    hasPhoto: i >= n - photos,
  }));
}

const layoutOf = (n: number, photos = 0): BouquetLayout =>
  composeBouquet({ month: '2026-10', memories: memories(n, photos) });

function options(over: Partial<RenderOptions> = {}): RenderOptions {
  return {
    idPrefix: 'b-',
    detail: 'full',
    interactive: true,
    polaroids: true,
    wash: true,
    background: null,
    text: true,
    labels: {
      root: 'Ramo de octubre de 2026',
      flower: (f) => `Flor ${f.id}`,
      overflow: (n) => `${n} recuerdos más`,
      overflowText: '+n más',
    },
    ...over,
  };
}

const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;
/** El SVG sin el contenido de los atributos: lo que queda son etiquetas y nombres de atributo. */
const markupOnly = (svg: string) => svg.replace(/="[^"]*"/g, '=""');
const withoutNamespace = (svg: string) => svg.replace(' xmlns="http://www.w3.org/2000/svg"', '');
const idsOf = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
const refsOf = (svg: string) => [
  ...[...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1] as string),
  ...[...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] as string),
];

describe('renderizado del ramo', () => {
  it('es determinista: el mismo ramo da exactamente el mismo SVG', () => {
    const layout = layoutOf(21, 5);
    expect(renderBouquet(layout, options())).toBe(renderBouquet(layout, options()));
  });

  it('el SVG es un documento completo con su nombre accesible', () => {
    const svg = renderBouquet(layoutOf(8), options());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ')).toBe(true);
    expect(svg).toContain('role="group"');
    expect(svg).toContain('aria-label="Ramo de octubre de 2026"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('sin interacción es una imagen y no tiene nada enfocable', () => {
    const svg = renderBouquet(layoutOf(8), options({ interactive: false }));
    expect(svg).toContain('role="img"');
    expect(svg).not.toContain('role="button"');
    expect(svg).not.toContain('tabindex');
  });

  it('cada flor es un botón enfocable con nombre accesible (y «+N más» también)', () => {
    for (const n of [1, 8, 21, 30]) {
      const layout = layoutOf(n);
      const svg = renderBouquet(layout, options());
      const buttons = count(svg, /role="button"/g);
      expect(buttons).toBe(layout.flowers.length + (layout.overflow ? 1 : 0));
      expect(count(svg, /tabindex="0"/g)).toBe(buttons);
      expect(count(svg, /aria-label="/g)).toBe(buttons + 1);
      for (const f of layout.flowers) expect(svg).toContain(`aria-label="Flor ${f.id}"`);
    }
  });

  it('el nombre accesible y los ids se escapan: nada de HTML inyectado', () => {
    const evil = '<img src=x onerror=alert(1)> "comillas" & más';
    const list: BouquetMemory[] = [
      { id: 'a"><script>x</script>', date: '2026-10-01', flower: 'rosa', hasPhoto: true },
    ];
    const svg = renderBouquet(
      composeBouquet({ month: '2026-10', memories: list }),
      options({
        labels: { root: evil, flower: () => evil, overflow: () => evil, overflowText: evil },
      }),
    );
    expect(markupOnly(svg)).not.toMatch(/<img|<script|\son[a-z]+=/i);
    expect(svg).toContain('&lt;img');
    expect(svg).toContain('&quot;comillas&quot;');
  });

  it('no contiene filtros, estilos en línea, scripts ni recursos externos', () => {
    const svg = renderBouquet(layoutOf(30, 5), options());
    expect(svg).not.toMatch(/\sstyle\s*=/i);
    expect(svg).not.toMatch(/<filter|filter=|feTurbulence|feDisplacementMap/i);
    expect(markupOnly(svg)).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=|xlink:href/i);
    expect(withoutNamespace(svg)).not.toMatch(/javascript:|https?:/i);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('los ids son únicos, llevan el prefijo y toda referencia está definida', () => {
    for (const n of [0, 1, 8, 30]) {
      const svg = renderBouquet(layoutOf(n, 5), options({ idPrefix: 'rama-' }));
      const defined = idsOf(svg);
      expect(new Set(defined).size).toBe(defined.length);
      for (const ref of refsOf(svg)) expect(defined.includes(ref)).toBe(true);
      for (const id of defined) expect(id.startsWith('rama-')).toBe(true);
    }
  });

  it('dos ramos con prefijos distintos pueden convivir en la misma página', () => {
    const a = idsOf(renderBouquet(layoutOf(8), options({ idPrefix: 'a-' })));
    const b = idsOf(renderBouquet(layoutOf(8), options({ idPrefix: 'b-' })));
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('el texto «+N más» solo se dibuja con text: true (la exportación lo dibuja aparte)', () => {
    const layout = layoutOf(30);
    expect(renderBouquet(layout, options({ text: true }))).toContain('<text');
    expect(renderBouquet(layout, options({ text: false }))).not.toContain('<text');
    expect(renderBouquet(layoutOf(8), options({ text: true }))).not.toContain('<text');
  });

  it('el fondo opaco va primero; sin fondo, el SVG es transparente', () => {
    const layout = layoutOf(8);
    expect(renderBouquet(layout, options({ background: '#f8f6f1' }))).toContain(
      '<rect width="600"',
    );
    expect(renderBouquet(layout, options({ background: null }))).not.toMatch(/<rect width="600"/);
  });

  it('un mes vacío se dibuja (capullos, ramas y lazo) sin flores', () => {
    const svg = renderBouquet(layoutOf(0), options());
    expect(count(svg, /role="button"/g)).toBe(0);
    expect(svg.length).toBeGreaterThan(1000);
  });

  it('las Polaroids solo se dibujan si se piden y hay fotos', () => {
    const layout = layoutOf(8, 4);
    expect(count(renderBouquet(layout, options({ polaroids: true })), /class="mg-pol"/g)).toBe(4);
    expect(renderBouquet(layout, options({ polaroids: false }))).not.toContain('mg-pol');
    expect(renderBouquet(layoutOf(8, 0), options())).not.toContain('mg-pol');
  });

  it('solo se incrustan fotos con URL blob: (nunca http, data ni javascript)', () => {
    const layout = layoutOf(8, 4);
    const [p0, p1, p2, p3] = layout.polaroids.map((p) => p.id);
    const images: Record<string, string> = {
      [p0 as string]: 'blob:https://app.example/1111-2222',
      [p1 as string]: 'https://evil.example/a.png',
      [p2 as string]: 'javascript:alert(1)',
      [p3 as string]: 'data:image/png;base64,AAAA',
    };
    const svg = renderBouquet(layout, options({ images }));
    expect(count(svg, /<image /g)).toBe(1);
    expect(svg).toContain('href="blob:https://app.example/1111-2222"');
    expect(svg).not.toMatch(/evil\.example|javascript:|data:image/);
  });

  it('el tamaño en píxeles solo se añade si se pide', () => {
    const layout = layoutOf(8);
    expect(renderBouquet(layout, options())).not.toMatch(/<svg[^>]* width=/);
    expect(renderBouquet(layout, options({ size: { width: 300, height: 400 } }))).toContain(
      ' width="300" height="400"',
    );
  });

  it('el relleno y el lazo son decorativos: ocultos a lectores de pantalla y sin foco', () => {
    const layout = layoutOf(8, 3);
    const svg = renderBouquet(layout, options());
    // Botones = flores; el relleno va dentro de grupos aria-hidden.
    expect(count(svg, /role="button"/g)).toBe(layout.flowers.length);
    expect(count(svg, /<g aria-hidden="true">/g)).toBe(2);
    // Las Polaroids no capturan clics: la flor de debajo sigue respondiendo.
    expect(count(svg, /class="mg-pol"[^>]*pointer-events="none"/g)).toBe(3);
  });

  it('textura de acuarela: solo la ruta propia; cualquier otra se ignora', () => {
    const layout = layoutOf(8);
    expect(renderBouquet(layout, options())).not.toContain('<image');
    expect(renderBouquet(layout, options({ washTexture: '/textures/wash.webp' }))).toContain(
      '<image href="/textures/wash.webp"',
    );
    for (const bad of [
      'https://evil.example/wash.webp',
      '/textures/../secret.webp',
      'javascript:alert(1)',
      'data:image/webp;base64,AAAA',
      '/textures/otra.webp',
    ]) {
      expect(renderBouquet(layout, options({ washTexture: bad }))).not.toContain('<image');
    }
  });

  it('con el aro de foco oculto por defecto (opacity 0) y animación solo por clases', () => {
    const svg = renderBouquet(layoutOf(8), options());
    expect(svg).toContain('class="mg-ring"');
    expect(svg).toMatch(/class="mg-fl mg-in d\d"/);
  });
});

describe('peso del ramo (presupuesto D-254)', () => {
  const doc = (n: number, detail: 'full' | 'lite') =>
    renderBouquet(layoutOf(n, 5), options({ detail }));
  const elements = (svg: string) => count(svg, /<[a-zA-Z]/g);

  it('21 flores a detalle completo: ≤ 240 KiB y ≤ 2.900 elementos (medido ~179 KiB y ~2.250)', () => {
    // Las flores nuevas reutilizan cada pétalo con <use>: pesan menos que las anteriores (~319 KiB).
    const svg = doc(21, 'full');
    expect(svg.length).toBeLessThan(240 * 1024);
    expect(elements(svg)).toBeLessThan(2900);
  });

  it('21 flores a detalle reducido: ≤ 190 KiB y ≤ 2.200 elementos (medido ~143 KiB y ~1.710)', () => {
    const svg = doc(21, 'lite');
    expect(svg.length).toBeLessThan(190 * 1024);
    expect(elements(svg)).toBeLessThan(2200);
  });

  it('el relleno decorativo solo: ≤ 45 KiB y ≤ 520 elementos (medido ~41 KiB y ~470)', () => {
    const layout = layoutOf(21, 5);
    const svg = renderBouquet({ ...layout, flowers: [], overflow: null }, options());
    expect(svg.length).toBeLessThan(45 * 1024);
    expect(elements(svg)).toBeLessThan(520);
  });

  it('con 100 recuerdos pesa casi lo mismo que con 21: el tope visual acota el peso', () => {
    // Margen del 25 %: cada flor pesa distinto (el tulipán ~2 KiB, la dalia ~10 KiB) y la muestra de
    // 21 flores cambia con el mes. Sin el tope, 100 recuerdos pesarían unas cinco veces más.
    expect(doc(100, 'full').length).toBeLessThan(doc(21, 'full').length * 1.25);
  });

  it('componer más el render de un ramo de 21 flores cabe de sobra en un fotograma de prueba', () => {
    const list = memories(21, 5);
    const t0 = performance.now();
    renderBouquet(composeBouquet({ month: '2026-10', memories: list }), options());
    // Límite muy holgado (medido ~7 ms en Node): solo detecta un coste desbocado, no es una medida de iPhone.
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
