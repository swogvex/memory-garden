/** Constantes del servidor (sessions-and-limits.md, data-model.md). Valores iniciales, configurables aquí y en ningún otro sitio. */

export const COOKIE_NAME_STRICT = '__Host-mg_session'; // D-055: producción y cualquier origen que no sea localhost
export const COOKIE_NAME_LOCAL = 'mg_session'; // solo `MG_ENV=local` y host localhost (Safari no admite __Host- por HTTP)

/**
 * `touchAfter`: `last_seen_at` se reescribe solo si lleva más de esto sin tocarse (ahorra escrituras de D1).
 * Debe ser muy inferior a `idle`: la inactividad real tolerada es `idle − touchAfter` como mínimo.
 */
export const SESSION = {
  full: { absolute: 12 * 3600, idle: 30 * 60, touchAfter: 5 * 60 },
  recovery: { absolute: 15 * 60, idle: 5 * 60, touchAfter: 60 },
} as const;

export type SessionScope = 'full' | 'recovery';

/** KDF aceptado por el servidor (crypto-spec §4.4; techo D-115). Coinciden con `PRODUCTION_KDF_POLICY` del cliente. */
export const KDF = {
  minIter: 600_000,
  maxIter: 10_000_000,
  alg: 'pbkdf2-sha256',
  version: 1,
} as const;

export const MAX_BODY_BYTES = 16 * 1024;

/** Retardo tras el fallo k-ésimo consecutivo (sessions-and-limits §7.1). 1–3 → 0 s. */
export const DELAYS = {
  4: 5,
  5: 15,
  6: 30,
  7: 60,
  8: 120,
} as const;

/** Tope del retardo (fallos ≥ 9) por cubo. */
export const DELAY_CAP = { acct: 5 * 60, ip: 15 * 60 } as const;

/** Tras esta ventana sin fallos el contador vuelve a cero. */
export const ATTEMPT_WINDOW = 3600;

/** Cubo global: si hay más de `threshold` fallos por hora, cada intento exige `spacing` s desde el anterior. */
export const GLOBAL = { threshold: 60, spacing: 30 } as const;

export const RETENTION = {
  loginAttempt: 24 * 3600,
  securityEvent: 180 * 24 * 3600,
} as const;

export const BUCKET = {
  login: 'acct:login',
  recover: 'acct:recover',
  setup: 'acct:setup',
  global: 'global:auth',
} as const;

/**
 * Límites de recuerdos y fotos (data-model.md §3, photos-and-storage.md §6; D-075, D-094, D-098).
 * Duplican a propósito los de `src/lib/storage/limits.ts` (el servidor no importa código de cliente);
 * una prueba comprueba que coinciden.
 */
export const MAX_PAYLOAD_CHARS = 65536;
/** Cuerpo JSON de `PUT /api/memories/:id`: carga ≤ 64 KiB + sobre JSON. */
export const MAX_MEMORY_BODY_BYTES = 72 * 1024;
export const MAX_MEMORIES = 20_000;
export const MAX_PHOTOS_PER_MEMORY = 5;
export const MAX_ASSETS_PER_MEMORY = 10; // fotos + miniaturas
export const MIN_ASSET_BYTES = 32;
export const MAX_ASSET_BYTES = {
  photo: 2 * 1024 * 1024,
  thumb: 256 * 1024,
  avatar: 128 * 1024,
} as const;
export const MAX_PENDING_ASSETS = 12;
export const MAX_PENDING_BYTES = 48 * 1024 * 1024;
export const DAILY_UPLOAD_BYTES = 200 * 1024 * 1024;
export const TOTAL_QUOTA_BYTES = 5 * 1024 ** 3;
/** Una subida sin ligar a un recuerdo se descarta pasada 1 h (data-model.md §7.6). */
export const PENDING_TTL = 3600;
/** Papelera: 30 días (D-058). */
export const TRASH_TTL = 30 * 24 * 3600;
/** Recuerdos por página de `GET /api/memories` (cada carga puede pesar hasta ~44 KiB). */
export const LIST_PAGE = 100;
/** Trabajo de limpieza que se permite en una sola petición (limpieza perezosa). */
export const SWEEP_BATCH = 20;
export const LAZY_PURGE_BATCH = 3;
