import type { FlowerId } from './catalog';
import { FLOWER_INFO } from './catalog';
import { leaf, stem } from './foliage';
import { HEADS } from './heads';
import { makeRng } from './rng';
import { Defs, type Detail } from './svg';

export interface StandaloneOptions {
  readonly seed: string;
  readonly tone?: number;
  readonly detail?: Detail;
  /** Prefijo de los identificadores del SVG (único por documento). */
  readonly idPrefix?: string;
  /** Con tallo y hojas (ilustración) o solo la cabeza (icono). */
  readonly stem?: boolean;
}

/** Una flor suelta como SVG completo (para el catálogo y los iconos grandes). */
export function renderFlower(id: FlowerId, options: StandaloneOptions): string {
  const detail = options.detail ?? 'full';
  const defs = new Defs(options.idPrefix ?? 'f-');
  const head = HEADS[id]({
    rng: makeRng(`${options.seed}|head`),
    defs,
    detail,
    tone: options.tone ?? 0,
  });
  const r = 56;
  if (!options.stem) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-r} ${-r} ${2 * r} ${2 * r}">${defs}${head.body}</svg>`;
  }
  const info = FLOWER_INFO[id];
  const ay = head.attach.y;
  const by = 128;
  const rng = makeRng(`${options.seed}|leaves`);
  const tone = options.tone ?? 0;
  const len = head.leaf === 'strap' ? 62 : 44;
  const lowY = by - 22;
  let body = stem(detail, head.attach.x, ay, 0, by, 3.4 * info.stem, 3);
  body += leaf(defs, detail, head.leaf, 0, lowY, -(52 + rng() * 14), len, tone);
  body += leaf(defs, detail, head.leaf, 0, lowY - 12, 48 + rng() * 14, len * 0.92, tone);
  body += head.body;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-r} ${-r} ${2 * r} ${by + r + 4}">${defs}${body}</svg>`;
}
