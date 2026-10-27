import type { HeadDrawer } from './draw/common';
import { drawCamelia } from './draw/camelia';
import { drawDalia } from './draw/dalia';
import { drawGirasol } from './draw/girasol';
import { drawHortensia } from './draw/hortensia';
import { drawLavanda } from './draw/lavanda';
import { drawMargarita } from './draw/margarita';
import { drawRosa } from './draw/rosa';
import { drawTulipan } from './draw/tulipan';
import type { FlowerId } from './catalog';

export const HEADS: Readonly<Record<FlowerId, HeadDrawer>> = {
  lavanda: drawLavanda,
  hortensia: drawHortensia,
  margarita: drawMargarita,
  rosa: drawRosa,
  tulipan: drawTulipan,
  girasol: drawGirasol,
  dalia: drawDalia,
  camelia: drawCamelia,
};
