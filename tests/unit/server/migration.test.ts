import { describe, expect, it } from 'vitest';
import { createD1, migrationSql, rows, type SqliteDb } from './_d1';

/** PS-46: la migración 0001 se aplica y las restricciones rechazan datos inválidos (sobre SQLite real; D1 local lo confirma el usuario con wrangler). */
const id = (c: string, n = 22) => c.repeat(n).slice(0, n);
const h43 = (c: string) => c.repeat(43).slice(0, 43);
const W = 'w'.repeat(86);
const KDF = '{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}';

function insertAccount(raw: SqliteDb, accountId = id('a')) {
  raw
    .prepare(
      'INSERT INTO account (id, auth_hash, recovery_auth_hash, created_at, credentials_updated_at) VALUES (?, ?, ?, 1, 1)',
    )
    .run(accountId, h43('h'), h43('r'));
}
function insertVault(raw: SqliteDb, vaultId = id('v'), accountId = id('a')) {
  raw
    .prepare(
      'INSERT INTO vault (id, account_id, kdf, wrapped_mk_pw, rec_salt, wrapped_mk_rec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)',
    )
    .run(vaultId, accountId, KDF, W, id('s'), W);
}
function insertMemory(raw: SqliteDb, memoryId = id('m'), vaultId = id('v')) {
  raw
    .prepare(
      'INSERT INTO memory (id, vault_id, payload, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
    )
    .run(memoryId, vaultId, 'p'.repeat(40));
}
function insertAsset(raw: SqliteDb, assetId: string, over: Record<string, unknown> = {}) {
  const v = {
    memory_id: null,
    parent_id: null,
    kind: 'photo',
    r2_key: h43(assetId.charAt(0)),
    size_bytes: 1000,
    state: 'pending',
    ...over,
  };
  raw
    .prepare(
      'INSERT INTO asset (id, vault_id, memory_id, parent_id, kind, r2_key, size_bytes, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    )
    .run(assetId, id('v'), v.memory_id, v.parent_id, v.kind, v.r2_key, v.size_bytes, v.state);
}
function fails(fn: () => void, fragment: string) {
  let message = '';
  try {
    fn();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  expect(message).toContain(fragment);
}

describe('migración 0001', () => {
  it('se aplica sobre una base vacía y crea las siete tablas e índices esperados', () => {
    const { raw } = createD1(false);
    raw.exec(migrationSql('0001_init.sql'));
    const names = rows<{ name: string }>(
      raw,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((r) => r.name);
    expect(names).toEqual([
      'account',
      'asset',
      'login_attempt',
      'memory',
      'security_event',
      'session',
      'vault',
    ]);
    const indexes = rows<{ name: string }>(
      raw,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    ).map((r) => r.name);
    for (const n of [
      'idx_memory_live',
      'idx_memory_trash',
      'idx_asset_memory',
      'idx_asset_state',
      'idx_asset_created',
      'idx_session_expires',
      'idx_login_attempt_updated',
      'idx_security_event_created',
    ]) {
      expect(indexes).toContain(n);
    }
  });

  it('no es idempotente a propósito: aplicarla dos veces falla (el control de «ya aplicada» es de wrangler)', () => {
    const { raw } = createD1();
    fails(() => raw.exec(migrationSql('0001_init.sql')), 'already exists');
  });

  it('cuenta única: una segunda cuenta se rechaza por `singleton` (D-001)', () => {
    const { raw } = createD1();
    insertAccount(raw, id('a'));
    fails(() => insertAccount(raw, id('b')), 'UNIQUE constraint failed: account.singleton');
  });

  it('account: longitudes de id y de hashes', () => {
    const { raw } = createD1();
    const ins = (a: string, h: string, r: string) =>
      raw
        .prepare(
          'INSERT INTO account (id, auth_hash, recovery_auth_hash, created_at, credentials_updated_at) VALUES (?, ?, ?, 1, 1)',
        )
        .run(a, h, r);
    fails(() => ins(id('a', 21), h43('h'), h43('r')), 'CHECK constraint failed');
    fails(() => ins(id('a'), h43('h').slice(0, 42), h43('r')), 'CHECK constraint failed');
    fails(() => ins(id('a'), h43('h'), h43('r') + 'x'), 'CHECK constraint failed');
  });

  it('vault: exige cuenta existente y valida longitudes', () => {
    const { raw } = createD1();
    fails(() => insertVault(raw), 'FOREIGN KEY constraint failed');
    insertAccount(raw);
    insertVault(raw);
    fails(() => insertVault(raw, id('w')), 'UNIQUE constraint failed: vault.account_id');
    const bad = (col: string, value: string) => () =>
      raw.prepare(`UPDATE vault SET ${col} = ? WHERE id = ?`).run(value, id('v'));
    fails(bad('kdf', '{"v":1}'), 'CHECK constraint failed');
    fails(bad('rec_salt', 'short'), 'CHECK constraint failed');
    fails(bad('wrapped_mk_pw', 'x'.repeat(79)), 'CHECK constraint failed');
    fails(bad('wrapped_mk_rec', 'x'.repeat(257)), 'CHECK constraint failed');
  });

  it('memory: payload mínimo y máximo, y vault existente', () => {
    const { raw } = createD1();
    insertAccount(raw);
    fails(() => insertMemory(raw), 'FOREIGN KEY constraint failed');
    insertVault(raw);
    insertMemory(raw);
    const put = (payload: string) => () =>
      raw
        .prepare(
          'INSERT INTO memory (id, vault_id, payload, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
        )
        .run(id('n'), id('v'), payload);
    fails(put('x'.repeat(21)), 'CHECK constraint failed');
    fails(put('x'.repeat(65537)), 'CHECK constraint failed');
  });

  it('asset: tipo, avatar sin recuerdo, «ready» ligado a un recuerdo, tamaños y clave de R2', () => {
    const { raw } = createD1();
    insertAccount(raw);
    insertVault(raw);
    insertMemory(raw);
    fails(() => insertAsset(raw, id('1'), { kind: 'video' }), 'CHECK constraint failed');
    fails(
      () => insertAsset(raw, id('2'), { kind: 'avatar', memory_id: id('m') }),
      'CHECK constraint failed',
    );
    fails(() => insertAsset(raw, id('3'), { state: 'ready' }), 'CHECK constraint failed'); // foto lista sin recuerdo
    insertAsset(raw, id('4'), { kind: 'avatar', state: 'ready' }); // el avatar sí puede estar listo sin recuerdo
    insertAsset(raw, id('5'), { state: 'ready', memory_id: id('m') });
    fails(() => insertAsset(raw, id('6'), { size_bytes: 31 }), 'CHECK constraint failed');
    fails(() => insertAsset(raw, id('7'), { size_bytes: 4_194_305 }), 'CHECK constraint failed');
    fails(
      () => insertAsset(raw, id('8'), { r2_key: h43('5') }),
      'UNIQUE constraint failed: asset.r2_key',
    ); // misma clave que el 5
    fails(() => insertAsset(raw, id('9'), { r2_key: 'corta' }), 'CHECK constraint failed');
  });

  it('RESTRICT: no se borra un recuerdo con recursos ni una foto con miniatura; el orden documentado sí funciona', () => {
    const { raw } = createD1();
    insertAccount(raw);
    insertVault(raw);
    insertMemory(raw);
    insertAsset(raw, id('p'), { state: 'ready', memory_id: id('m') });
    insertAsset(raw, id('t'), {
      kind: 'thumb',
      state: 'ready',
      memory_id: id('m'),
      parent_id: id('p'),
      r2_key: h43('t'),
    });
    fails(
      () => raw.prepare('DELETE FROM memory WHERE id = ?').run(id('m')),
      'FOREIGN KEY constraint failed',
    );
    fails(
      () => raw.prepare('DELETE FROM asset WHERE id = ?').run(id('p')),
      'FOREIGN KEY constraint failed',
    );
    raw.prepare('DELETE FROM asset WHERE id = ?').run(id('t')); // miniatura primero
    raw.prepare('DELETE FROM asset WHERE id = ?').run(id('p'));
    raw.prepare('DELETE FROM memory WHERE id = ?').run(id('m'));
    expect(rows(raw, 'SELECT id FROM memory')).toHaveLength(0);
  });

  it('session: ámbito válido, hash de 43 caracteres y cuenta existente; se borra en cascada con la cuenta', () => {
    const { raw } = createD1();
    const ins = (t: string, acc: string, scope: string) =>
      raw
        .prepare(
          'INSERT INTO session (token_hash, account_id, scope, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, 1, 1, 2)',
        )
        .run(t, acc, scope);
    fails(() => ins(h43('t'), id('a'), 'full'), 'FOREIGN KEY constraint failed');
    insertAccount(raw);
    fails(() => ins(h43('t'), id('a'), 'admin'), 'CHECK constraint failed');
    fails(() => ins('t'.repeat(42), id('a'), 'full'), 'CHECK constraint failed');
    ins(h43('t'), id('a'), 'full');
    raw.prepare('DELETE FROM account').run();
    expect(rows(raw, 'SELECT * FROM session')).toHaveLength(0);
  });

  it('security_event: tipos válidos y `created_at` NOT NULL (la guardia de key_revision depende de ello)', () => {
    const { raw } = createD1();
    fails(
      () => raw.prepare("INSERT INTO security_event (type, created_at) VALUES ('hackeo', 1)").run(),
      'CHECK constraint failed',
    );
    fails(
      () =>
        raw.prepare("INSERT INTO security_event (type, created_at) VALUES ('setup', NULL)").run(),
      'NOT NULL constraint failed: security_event.created_at',
    );
    raw.prepare("INSERT INTO security_event (type, created_at) VALUES ('setup', 1)").run();
  });

  it('login_attempt: nombre de cubo de hasta 64 caracteres', () => {
    const { raw } = createD1();
    const ins = (b: string) =>
      raw
        .prepare('INSERT INTO login_attempt (bucket, window_start, updated_at) VALUES (?, 1, 1)')
        .run(b);
    ins('x'.repeat(64));
    fails(() => ins('x'.repeat(65)), 'CHECK constraint failed');
  });
});

describe('migración 0002 (H8.3b)', () => {
  it('añade `setup_lock` sobre 0001 y solo admite huellas de 43 caracteres', () => {
    const { raw } = createD1(false);
    raw.exec(migrationSql('0001_init.sql'));
    raw.exec(migrationSql('0002_setup_lock.sql'));
    raw.prepare('INSERT INTO setup_lock (code_hash, created_at) VALUES (?, 1)').run('a'.repeat(43));
    fails(
      () =>
        raw.prepare('INSERT INTO setup_lock (code_hash, created_at) VALUES (?, 1)').run('corto'),
      'CHECK constraint failed',
    );
    fails(
      () =>
        raw
          .prepare('INSERT INTO setup_lock (code_hash, created_at) VALUES (?, 1)')
          .run('a'.repeat(43)),
      'UNIQUE constraint failed',
    );
  });
});
