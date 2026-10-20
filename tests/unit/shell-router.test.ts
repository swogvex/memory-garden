import { describe, expect, it } from 'vitest';
import { NAV_LABEL_KEY, PATHS, VIEW_SLUGS, VIEWS, viewFromPath } from '@/features/shell/router';
import { es } from '@/lib/i18n/es';

describe('enrutador de la isla', () => {
  it('reconoce las rutas con y sin barra final', () => {
    expect(viewFromPath('/jardin')).toBe('garden');
    expect(viewFromPath('/jardin/')).toBe('garden');
    expect(viewFromPath('/ramos')).toBe('bouquets');
    expect(viewFromPath('/explorar')).toBe('explore');
    expect(viewFromPath('/configuracion')).toBe('settings');
  });
  it('rechaza lo demás', () => {
    for (const p of ['/', '/jardin/extra', '/Jardin', '/dev/componentes', '']) {
      expect(viewFromPath(p), p).toBeNull();
    }
  });
  it('los parámetros de ruta salen de las rutas y los textos existen', () => {
    expect(VIEW_SLUGS).toEqual(['jardin', 'ramos', 'explorar', 'configuracion']);
    for (const v of VIEWS) {
      expect(PATHS[v].startsWith('/')).toBe(true);
      expect(es[NAV_LABEL_KEY[v]]).toBeTruthy();
    }
  });
});
