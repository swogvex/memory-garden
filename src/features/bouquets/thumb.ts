import { f, spriteHref, STEM_COLOR } from '@/lib/flowers';
import type { BouquetLayout } from './model';

const LEAF = 'M0 0C-9-8-12-26-2-44C10-28 9-8 0 0Z';

/**
 * Miniatura de un ramo para la cuadrícula de meses. Reutiliza las cabezas del sprite (`<use>`), así que
 * 12 miniaturas pesan unos KiB cada una en lugar de cientos. Es decorativa (`aria-hidden`): el botón que
 * la contiene lleva el nombre accesible. Requiere que el sprite (`renderFlowerSprite`) esté en la página.
 */
export function renderBouquetThumb(layout: BouquetLayout): string {
  const base = layout.base;
  let leaves = '';
  for (const l of layout.leaves) {
    const k = l.length / 44;
    leaves += `<path d="${LEAF}" fill="#7a9671" stroke="#2f4a2e" stroke-opacity=".35" stroke-width="1.6" transform="translate(${f(l.x)} ${f(l.y)}) rotate(${f(l.rot)}) scale(${f(k)})"/>`;
  }
  let stems = '';
  let heads = '';
  for (const fl of layout.flowers) {
    const y0 = fl.y + fl.radius * 0.55;
    stems += `<path d="M${f(fl.x)} ${f(y0)}Q${f((fl.x + fl.stemX) / 2)} ${f((y0 + base.y) / 2)} ${f(fl.stemX)} ${f(base.y)}" fill="none" stroke="${STEM_COLOR}" stroke-width="${f(4 + fl.radius * 0.04)}" stroke-linecap="round"/>`;
    heads += `<use href="${spriteHref(fl.flower)}" transform="translate(${f(fl.x)} ${f(fl.y)}) rotate(${f(fl.rot)}) scale(${f(fl.scale)})"/>`;
  }
  const bow =
    layout.total > 0
      ? `<g transform="translate(${f(base.x)} ${f(base.y)})"><path d="M-28-4C-9 2 9 2 28-4L28 14C9 20-9 20-28 14Z" fill="#7a5fa8"/><path d="M0 0C-24-34-72-34-66 0C-62 24-24 18 0 0Z" fill="#5b3f8f"/><path d="M0 0C24-34 72-34 66 0C62 24 24 18 0 0Z" fill="#5b3f8f"/><ellipse cy="3" rx="12" ry="10" fill="#b8a0d9"/></g>`
      : '';
  const more = layout.overflow
    ? `<circle cx="${f(layout.overflow.x)}" cy="${f(layout.overflow.y)}" r="22" fill="#c9a8e0" stroke="#6f4fae" stroke-opacity=".4" stroke-width="2"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} 640" aria-hidden="true" focusable="false">${leaves}${stems}${bow}${heads}${more}</svg>`;
}
