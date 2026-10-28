import { fromB64Url, type Bytes } from './bytes';
import type { D1Like } from './d1';

/**
 * Entorno que necesita el servidor. `PEPPER` y `SETUP_CODE` son secretos del Worker (`wrangler secret put` en
 * producción, `.dev.vars` en local; D-160). `MG_ENV` y `EXTRA_ORIGINS` solo se leen si `MG_ENV === 'local'`.
 */
export interface ApiEnv {
  DB: D1Like;
  PEPPER?: string;
  SETUP_CODE?: string;
  MG_ENV?: string;
  EXTRA_ORIGINS?: string;
}

export interface Config {
  pepper: Bytes;
  /** Código de configuración normalizado, o `null` si no hay (el primer acceso queda cerrado). */
  setupCode: string | null;
  local: boolean;
  extraOrigins: readonly string[];
}

/** Normalización del código de configuración y de la clave de recuperación: sin guiones ni espacios, mayúsculas, O→0, I/L→1. */
export function normalizeCode(text: string): string {
  return text
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Devuelve `null` si la configuración es inválida: el servidor responde 500 genérico y no arranca nada a medias. */
export function loadConfig(env: ApiEnv): Config | null {
  const pepper = typeof env.PEPPER === 'string' ? fromB64Url(env.PEPPER) : null;
  if (!pepper || pepper.length !== 32) return null;
  const rawCode = typeof env.SETUP_CODE === 'string' ? normalizeCode(env.SETUP_CODE) : '';
  const local = env.MG_ENV === 'local';
  const extraOrigins =
    local && env.EXTRA_ORIGINS
      ? env.EXTRA_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [];
  return { pepper, setupCode: rawCode.length >= 20 ? rawCode : null, local, extraOrigins };
}
