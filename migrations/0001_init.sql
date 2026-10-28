-- Memory Garden · migración 0001 (data-model.md v2, §3).
-- Tiempos: segundos Unix UTC. Identificadores: base64url sin relleno.
-- 16 B -> 22 caracteres · 32 B -> 43 caracteres.
-- Solo hacia delante (D-031): un cambio posterior va en 0002_*.sql, nunca editando este archivo.

CREATE TABLE account (
  id                     TEXT PRIMARY KEY CHECK (length(id) = 22),
  singleton              INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,   -- una sola cuenta (D-001)
  auth_hash              TEXT NOT NULL CHECK (length(auth_hash) = 43),               -- HMAC-SHA256(pepper, auth_pw)
  recovery_auth_hash     TEXT NOT NULL CHECK (length(recovery_auth_hash) = 43),      -- HMAC-SHA256(pepper, auth_rec)
  pepper_version         INTEGER NOT NULL DEFAULT 1,
  created_at             INTEGER NOT NULL,
  credentials_updated_at INTEGER NOT NULL
);

CREATE TABLE vault (
  id                 TEXT PRIMARY KEY CHECK (length(id) = 22),
  account_id         TEXT NOT NULL UNIQUE REFERENCES account(id) ON DELETE CASCADE,
  schema_version     INTEGER NOT NULL DEFAULT 1,
  mk_version         INTEGER NOT NULL DEFAULT 1,
  key_revision       INTEGER NOT NULL DEFAULT 1,          -- concurrencia de cambios de claves
  kdf                TEXT NOT NULL CHECK (length(kdf) BETWEEN 40 AND 400),  -- JSON canónico {"v","alg","iter","salt"}
  wrapped_mk_pw      TEXT NOT NULL CHECK (length(wrapped_mk_pw)  BETWEEN 80 AND 256),
  rec_salt           TEXT NOT NULL CHECK (length(rec_salt) = 22),
  wrapped_mk_rec     TEXT NOT NULL CHECK (length(wrapped_mk_rec) BETWEEN 80 AND 256),
  settings_payload   TEXT CHECK (settings_payload IS NULL OR length(settings_payload) <= 65536),
  settings_revision  INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE memory (
  id              TEXT PRIMARY KEY CHECK (length(id) = 22),
  vault_id        TEXT NOT NULL REFERENCES vault(id) ON DELETE CASCADE,
  payload         TEXT NOT NULL CHECK (length(payload) BETWEEN 22 AND 65536),  -- envoltorio base64url
  schema_version  INTEGER NOT NULL DEFAULT 1,
  mk_version      INTEGER NOT NULL DEFAULT 1,
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER                                   -- NULL = visible; fecha = en papelera
);
CREATE INDEX idx_memory_live  ON memory (vault_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_memory_trash ON memory (deleted_at)           WHERE deleted_at IS NOT NULL;

CREATE TABLE asset (
  id           TEXT PRIMARY KEY CHECK (length(id) = 22),
  vault_id     TEXT NOT NULL REFERENCES vault(id) ON DELETE CASCADE,
  memory_id    TEXT REFERENCES memory(id) ON DELETE RESTRICT,     -- NULL si es avatar o si la subida aún no se ha ligado (pending)
  parent_id    TEXT REFERENCES asset(id) ON DELETE RESTRICT,      -- miniatura -> su foto
  kind         TEXT NOT NULL CHECK (kind IN ('photo','thumb','avatar')),
  r2_key       TEXT NOT NULL UNIQUE CHECK (length(r2_key) = 43),  -- 256 bits aleatorios, sin relación con el id
  size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 32 AND 4194304),
  mk_version   INTEGER NOT NULL DEFAULT 1,
  state        TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','deleting')),
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  CHECK (kind <> 'avatar' OR (memory_id IS NULL AND parent_id IS NULL)),
  CHECK (kind = 'avatar' OR state <> 'ready' OR memory_id IS NOT NULL)
);
CREATE INDEX idx_asset_memory  ON asset (memory_id);
CREATE INDEX idx_asset_state   ON asset (state, created_at);
CREATE INDEX idx_asset_created ON asset (vault_id, created_at);  -- tope diario de subidas (D-098)

CREATE TABLE session (
  token_hash   TEXT PRIMARY KEY CHECK (length(token_hash) = 43),   -- SHA-256(token); el token no se guarda
  account_id   TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('full','recovery')),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL                                    -- caducidad absoluta
);
CREATE INDEX idx_session_expires ON session (expires_at);

CREATE TABLE login_attempt (                                        -- contadores por cubo, no un registro de eventos
  bucket        TEXT PRIMARY KEY CHECK (length(bucket) <= 64),     -- 'acct:login' | 'acct:recover' | 'acct:setup' | 'global:auth' | 'ip:<huella 16 hex>'
  fail_count    INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_login_attempt_updated ON login_attempt (updated_at);

CREATE TABLE security_event (                                       -- sin IP, sin datos personales
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN
              ('setup','login_ok','login_fail_burst','password_changed','recovery_used',
               'recovery_key_regenerated','kdf_upgraded','sessions_revoked','export_created')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_security_event_created ON security_event (created_at);
