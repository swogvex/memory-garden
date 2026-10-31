import { EXPORT_BACKGROUND, TEXTURE_PATH, coverRect, planExport } from './export-plan';
import type { BouquetLayout } from './model';
import { renderBouquet } from './render';

export interface ExportInput {
  readonly layout: BouquetLayout;
  /** Nombre accesible del dibujo (solo por completitud del SVG). */
  readonly rootLabel: string;
  /** Texto bajo el ramo, p. ej. «Octubre de 2026 · 8 recuerdos». */
  readonly caption: string;
  /** Texto del racimo «+N más»; sin él no se escribe nada. */
  readonly overflowText?: string;
  /** URL `blob:` de la foto de cada recuerdo (id → URL). */
  readonly photos: Readonly<Record<string, string>>;
  readonly titleFont: string;
  readonly textFont: string;
  /** Texturas propias (mismo origen). Si faltan o no cargan, el PNG sale sin ellas. */
  readonly textures?: { readonly paper: string; readonly wash: string };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('export:image'));
    img.src = url;
  });
}

async function loadTexture(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url || !TEXTURE_PATH.test(url)) return null;
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

/**
 * Dibuja el ramo en un lienzo y devuelve un PNG. Método:
 *  0. Fondo marfil, papel (patrón multiplicado) y mancha de acuarela centrada en la copa.
 *  1. El SVG del ramo (sin fotos) se rasteriza a la resolución final con `drawImage` (nítido: es vectorial).
 *  2. Las fotos y los textos se dibujan encima en el lienzo, porque un SVG cargado como imagen no puede
 *     leer `blob:`, ni archivos externos, ni usar las fuentes de la página.
 * El PNG no lleva metadatos (ni Exif ni GPS). Solo se leen URLs `blob:` creadas por la propia aplicación.
 */
export async function exportBouquetPng(input: ExportInput): Promise<Blob> {
  const plan = planExport(input.layout);
  const canvas = document.createElement('canvas');
  canvas.width = plan.canvasWidth;
  canvas.height = plan.canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('export:canvas');

  const [paper, wash] = await Promise.all([
    loadTexture(input.textures?.paper),
    loadTexture(input.textures?.wash),
    document.fonts?.load(`600 17px ${input.textFont}`),
    document.fonts?.load(`600 30px ${input.titleFont}`),
  ]);

  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (paper) {
    const pattern = ctx.createPattern(paper, 'repeat');
    if (pattern) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }
  if (wash) {
    const { x, y, size } = plan.wash;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(
      wash,
      (x - size / 2) * plan.scale,
      (y - size / 2) * plan.scale,
      size * plan.scale,
      size * plan.scale,
    );
    ctx.restore();
  }

  const svg = renderBouquet(input.layout, {
    idPrefix: 'ex-',
    detail: 'full',
    interactive: false,
    polaroids: true,
    wash: true,
    background: null,
    text: false,
    size: {
      width: Math.round(plan.art.w * plan.scale),
      height: Math.round(plan.art.h * plan.scale),
    },
    labels: { root: input.rootLabel, flower: () => '', overflow: () => '' },
  });
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const art = await loadImage(svgUrl);
    ctx.drawImage(
      art,
      0,
      plan.art.y * plan.scale,
      plan.art.w * plan.scale,
      plan.art.h * plan.scale,
    );
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  for (const p of plan.photos) {
    const url = input.photos[p.id];
    if (!url || !url.startsWith('blob:')) continue;
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      continue; // foto no disponible: queda el hueco lila
    }
    const crop = coverRect(img.naturalWidth, img.naturalHeight, p.box.w, p.box.h);
    ctx.save();
    ctx.scale(plan.scale, plan.scale);
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.beginPath();
    ctx.rect(p.box.x, p.box.y, p.box.w, p.box.h);
    ctx.clip();
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, p.box.x, p.box.y, p.box.w, p.box.h);
    ctx.restore();
  }

  ctx.save();
  ctx.scale(plan.scale, plan.scale);
  ctx.fillStyle = '#37313f';
  ctx.textAlign = 'center';
  if (plan.overflow && input.overflowText) {
    ctx.font = `600 17px ${input.textFont}`;
    ctx.fillText(input.overflowText, plan.overflow.x, plan.overflow.y + 42);
  }
  ctx.font = `600 30px ${input.titleFont}`;
  ctx.fillText(input.caption, plan.caption.x, plan.caption.y, plan.width - 48);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('export:blob'))), 'image/png');
  });
}

/** Descarga un blob con un nombre seguro (enlace temporal que se revoca después). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
