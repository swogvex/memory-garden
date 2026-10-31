-- Memory Garden · migración 0002 (H8.3b): códigos de configuración ya gastados.
-- Al eliminar el espacio se guarda aquí una huella del código de configuración vigente (HMAC con el pepper, no el código):
-- con ese código ya no se puede crear otro espacio hasta subir uno NUEVO (`wrangler secret put SETUP_CODE`).
-- Esta tabla NO se borra al eliminar el espacio. Solo hacia delante (D-031).

CREATE TABLE setup_lock (
  code_hash  TEXT PRIMARY KEY CHECK (length(code_hash) = 43),   -- HMAC-SHA256(pepper, 'mg1/setup-lock|' || código)
  created_at INTEGER NOT NULL
);
