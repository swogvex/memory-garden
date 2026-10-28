/** Interfaz pública de src/server: solo la importan las rutas de src/pages (regla de capas de ESLint). */
export { API_ROUTES, handleApi } from './router';
export type { Deps, Route } from './router';
export type { ApiEnv } from './env';
export type { D1Like } from './d1';
