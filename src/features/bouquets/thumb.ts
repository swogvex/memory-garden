import { f, spriteHref } from '@/lib/flowers';
import type { BouquetLayout, PlacedFiller } from './model';
import { stemPath } from './stem-geometry';

const LEAF = 'M0 0C-9-8-12-26-2-44C10-28 9-8 0 0Z';
const STEM = '#7a8f70';

/** Relleno simplificado para la miniatura: unas pocas formas planas, sin degradados. */
function fillerThumb(fi: PlacedFiller): string {
  const L = fi.length;
  let inner: string;
  if (fi.kind === 'sprig') {
    inner = `<path d="M0 0L0 ${f(-L)}" stroke="${STEM}" stroke-width="2"/><path d="M0 ${f(-L * 0.45)}L0 ${f(-L)}" stroke="#c4b2e4" stroke-width="7" stroke-linecap="round"/>`;
  } else if (fi.kind === 'gyps') {
    // A tamaño de miniatura las florecillas no se ven: solo su tallo (ya dibujado).
    return '';
  } else if (fi.kind === 'greens') {
    inner = `<path d="M0 0L0 ${f(-L)}" stroke="${STEM}" stroke-width="2.4"/><path d="M0 0C-5-4-7-13-1-22C5-14 5-4 0 0Z" fill="#a9bd9f" transform="translate(0 ${f(-L)}) scale(1.6)"/>`;
  } else {
    inner = `<path d="M0 0C-8-4-9-19 0-30C9-19 8-4 0 0Z" transform="scale(${f(L / 30)})" fill="#e3d3ec" stroke="#8a7a98" stroke-width="1"/>`;
  }
  return `<g transform="translate(${f(fi.x)} ${f(fi.y)}) rotate(${f(fi.rot)})">${inner}</g>`;
}

/**
 * Miniatura de un ramo para la cuadrícula de meses. Reutiliza las cabezas del sprite (`<use>`), así que
 * 12 miniaturas pesan unos KiB cada una en lugar de cientos. Es decorativa (`aria-hidden`): el botón que
 * la contiene lleva el nombre accesible. Requiere que el sprite (`renderFlowerSprite`) esté en la página.
 * Sin texturas ni acuarela (decisión A de H7.5).
 */
export function renderBouquetThumb(layout: BouquetLayout): string {
  const base = layout.base;
  // Atributos comunes en el grupo: la miniatura pesa menos.
  let stems = `<g fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round">`;
  for (const fi of layout.filler) stems += `<path d="${stemPath(fi.stem)}"/>`;
  for (const fl of layout.flowers) {
    stems += `<path d="${stemPath(fl.stem)}" stroke-width="${f(Math.max(3, fl.stem.width * 1.3))}"/>`;
  }
  stems += '</g>';
  let leaves = '';
  for (const l of layout.leaves) {
    leaves += `<path d="${LEAF}" fill="#94ab8a" transform="translate(${f(l.x)} ${f(l.y)}) rotate(${f(l.rot)}) scale(${f(l.length / 44)})"/>`;
  }
  let filler = '';
  for (const fi of layout.filler) filler += fillerThumb(fi);
  let heads = '';
  for (const fl of layout.flowers) {
    heads += `<use href="${spriteHref(fl.flower)}" transform="translate(${f(fl.x)} ${f(fl.y)}) rotate(${f(fl.rot)}) scale(${f(fl.scale)})"/>`;
  }
  const bow =
    `<g transform="translate(${f(base.x)} ${f(base.y)}) scale(${f(layout.bowScale)})" fill="#c8b7e6" stroke="#7f68ad" stroke-opacity=".5" stroke-width="1.5">` +
    `<path d="M-6 8C-14 34-26 66-44 108L-30 100L-22 116C-8 78 0 44 3 10ZM5 8C14 30 24 60 34 96L46 86L52 102C40 66 18 34 10 7Z"/>` +
    `<path d="M-6 0C-22-30-66-42-76-12C-82 8-58 22-6 6ZM6 0C22-30 66-42 76-12C82 8 58 22 6 6Z"/>` +
    `<ellipse cy="3" rx="12" ry="11"/></g>`;
  const more = layout.overflow
    ? `<circle cx="${f(layout.overflow.x)}" cy="${f(layout.overflow.y)}" r="22" fill="#d3c0e8" stroke="#7f68ad" stroke-opacity=".4" stroke-width="2"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true" focusable="false">${stems}${leaves}${filler}${bow}${heads}${more}</svg>`;
}
