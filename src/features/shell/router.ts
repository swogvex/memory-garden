import type { MessageKey } from '@/lib/i18n';

export const VIEWS = ['garden', 'bouquets', 'explore', 'settings'] as const;
export type View = (typeof VIEWS)[number];

export const PATHS = {
  garden: '/jardin',
  bouquets: '/ramos',
  explore: '/explorar',
  settings: '/configuracion',
} as const satisfies Record<View, string>;

export const NAV_LABEL_KEY = {
  garden: 'nav.garden',
  bouquets: 'nav.bouquets',
  explore: 'nav.explore',
  settings: 'nav.settings',
} as const satisfies Record<View, MessageKey>;

/** `jardin`, `ramos`…: parámetros de la ruta `[view]`. */
export const VIEW_SLUGS: string[] = VIEWS.map((v) => PATHS[v].slice(1));

/** Acepta barra final. Devuelve `null` si la ruta no es de la aplicación. */
export function viewFromPath(pathname: string): View | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return VIEWS.find((v) => PATHS[v] === clean) ?? null;
}
