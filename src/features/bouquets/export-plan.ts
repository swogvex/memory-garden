import type { BouquetLayout } from './model';

/** Márgenes de la imagen exportada, en unidades del lienzo del ramo (600 de ancho). */
const EXPORT_TOP = 24;
const EXPORT_BOTTOM = 96;
/** Fondo opaco (marfil de la identidad visual). */
export const EXPORT_BACKGROUND = '#F8F6F1';
/** Anchura objetivo en píxeles: 2400 px (escala 4). */
const EXPORT_TARGET_WIDTH = 2400;
/** Topes de seguridad para iOS y navegadores con lienzos limitados. */
export const EXPORT_MAX_SIDE = 4096;
export const EXPORT_MAX_PIXELS = 16_000_000;

interface ExportPhotoPlan {
  readonly id: string;
  /** Centro de la Polaroid y giro, en unidades del lienzo (ya con el margen superior). */
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  /** Hueco de la foto, relativo al centro de la Polaroid. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface ExportPlan {
  readonly scale: number;
  /** Tamaño lógico (unidades del lienzo) y en píxeles. */
  readonly width: number;
  readonly height: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Zona del dibujo SVG dentro de la imagen. */
  readonly art: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly photos: readonly ExportPhotoPlan[];
  readonly overflow: { readonly x: number; readonly y: number } | null;
  readonly caption: { readonly x: number; readonly y: number };
  /** Mancha de acuarela (textura WebP) centrada en la copa, en unidades del lienzo. */
  readonly wash: { readonly x: number; readonly y: number; readonly size: number };
}

/** La mayor escala (en pasos de 0,25) que cabe en los topes; nunca menos de 1. */
export function chooseScale(width: number, height: number, target = EXPORT_TARGET_WIDTH): number {
  let scale = target / width;
  const fits = (s: number) =>
    width * s <= EXPORT_MAX_SIDE &&
    height * s <= EXPORT_MAX_SIDE &&
    Math.round(width * s) * Math.round(height * s) <= EXPORT_MAX_PIXELS;
  while (scale > 1 && !fits(scale)) scale -= 0.25;
  return Math.max(1, scale);
}

/** Nombre de archivo seguro: solo letras minúsculas, cifras y guiones. */
export function exportFileName(month: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `ramo-${month}.png` : 'ramo.png';
}

/** Recorte «cover»: la parte de una imagen origen que llena un hueco sin deformarse. */
export function coverRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const k = Math.max(boxW / srcW, boxH / srcH);
  const sw = boxW / k;
  const sh = boxH / k;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/** Qué se dibuja y dónde. Función pura: no toca el DOM ni los datos. */
export function planExport(layout: BouquetLayout): ExportPlan {
  const artH = layout.height;
  const height = EXPORT_TOP + artH + EXPORT_BOTTOM;
  const scale = chooseScale(layout.width, height);
  return {
    scale,
    width: layout.width,
    height,
    canvasWidth: Math.round(layout.width * scale),
    canvasHeight: Math.round(height * scale),
    art: { x: 0, y: EXPORT_TOP, w: layout.width, h: artH },
    photos: layout.polaroids.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y + EXPORT_TOP,
      rot: p.rot,
      box: p.photo,
    })),
    overflow: layout.overflow ? { x: layout.overflow.x, y: layout.overflow.y + EXPORT_TOP } : null,
    caption: { x: layout.width / 2, y: EXPORT_TOP + artH + 56 },
    wash: washPlacement(layout, EXPORT_TOP),
  };
}

/**
 * Dónde va la mancha de acuarela: un cuadrado centrado en la copa y algo mayor que ella.
 * Lo usan la exportación (lienzo) y la vista de detalle (clase CSS por tamaño). Función pura.
 */
export function washPlacement(
  layout: BouquetLayout,
  top = 0,
): { x: number; y: number; size: number } {
  const empty = layout.flowers.length === 0;
  const size = Math.round(
    Math.min(560, Math.max(300, Math.max(layout.dome.rx, layout.dome.ry) * 2 + 170)),
  );
  const cy = empty ? layout.base.y - 200 : layout.dome.y + 10;
  return { x: layout.width / 2, y: Math.round(cy + top), size };
}

/** Rutas permitidas para las texturas: solo las propias, servidas por la aplicación. */
export const TEXTURE_PATH = /^\/?textures\/(paper|wash)\.webp$/;
