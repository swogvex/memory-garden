import type { FlowerId } from './catalog';
import { FLOWER_IDS } from './catalog';
import { HEADS } from './heads';
import { makeRng } from './rng';
import { Defs } from './svg';

/** Radio del recuadro de una cabeza suelta (mismo que `renderFlower`). */
const SPRITE_RADIUS = 56;
/** `viewBox` para mostrar una cabeza del sprite sola. */
export const SPRITE_VIEWBOX = `${-SPRITE_RADIUS} ${-SPRITE_RADIUS} ${2 * SPRITE_RADIUS} ${2 * SPRITE_RADIUS}`;

/** Id del grupo de una flor dentro del sprite (único por documento: va una sola vez en la página). */
export const spriteId = (flower: FlowerId): string => `fs-${flower}`;
/** Referencia `<use href>` a la cabeza de una flor del sprite. */
export const spriteHref = (flower: FlowerId): string => `#${spriteId(flower)}`;

/**
 * Sprite con las 8 cabezas (detalle `icon`, tono 0, semilla fija) como `<g id="fs-…">` dentro de `<defs>`.
 * Se monta una vez; miniaturas e iconos lo reutilizan con `<use>`. Es texto estático: no lleva datos del usuario.
 */
export function renderFlowerSprite(): string {
  let out = '';
  for (const id of FLOWER_IDS) {
    const defs = new Defs(`fs-${id}-`);
    const head = HEADS[id]({ rng: makeRng(`sprite|${id}`), defs, detail: 'icon', tone: 0 });
    out += `${defs}<defs><g id="${spriteId(id)}">${head.body}</g></defs>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="flower-sprite" width="0" height="0" aria-hidden="true" focusable="false">${out}</svg>`;
}
