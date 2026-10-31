import { describe, expect, it } from 'vitest';
import { rows } from './_d1';
import {
  T0,
  doSetup,
  fakeAsset,
  fakePayload,
  makeHarness,
  newId,
  putAssetCall,
  putMemoryCall,
} from './_support';

/** Recuerdos: crear, leer, editar con revisión, papelera, borrado definitivo, conflictos y límites (PS-03, PS-04, PS-44). */
async function ready() {
  const h = makeHarness();
  const { cookie } = await doSetup(h);
  return { h, cookie };
}

describe('crear y leer', () => {
  it('PUT crea (revisión 1), GET lo devuelve idéntico y la lista lo incluye', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const payload = fakePayload();
    const put = await putMemoryCall(h, cookie, id, { payload });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({ id, revision: 1, created_at: T0, updated_at: T0 });
    const got = await h.call('GET', `/api/memories/${id}`, { cookie });
    expect(got.json).toMatchObject({ id, payload, revision: 1, deleted_at: null, assets: [] });
    const list = await h.call('GET', '/api/memories', { cookie });
    expect((list.json?.items as unknown[]).length).toBe(1);
    expect(list.json?.next).toBeNull();
    expect(list.json?.server_time).toBe(T0);
  });

  it('el servidor guarda la carga TAL CUAL: ni la abre ni la normaliza', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const payload = fakePayload(900);
    await putMemoryCall(h, cookie, id, { payload });
    expect(rows<{ payload: string }>(h.raw, 'SELECT payload FROM memory')[0]?.payload).toBe(
      payload,
    );
  });

  it('crear con un id que ya existe: 409 con la versión actual; no sobrescribe', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const first = fakePayload();
    await putMemoryCall(h, cookie, id, { payload: first });
    const again = await putMemoryCall(h, cookie, id, { payload: fakePayload() });
    expect(again.status).toBe(409);
    expect((again.json?.current as { payload: string }).payload).toBe(first);
  });

  it('id inexistente o con formato raro: GET 404 idéntico', async () => {
    const { h, cookie } = await ready();
    for (const id of [newId(), 'corto', '..%2F..%2Fetc', 'A'.repeat(22), '%00']) {
      const r = await h.call('GET', `/api/memories/${id}`, { cookie });
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: 'not_found' });
    }
  });
});

describe('validación de la carga (PS-03)', () => {
  it('rechaza carga ausente, no base64url, demasiado corta, demasiado larga o con cabecera/versión incorrecta', async () => {
    const { h, cookie } = await ready();
    const bad: unknown[] = [
      undefined,
      5,
      '',
      'corta',
      'no es base64url!!!'.padEnd(60, 'x'),
      fakePayload(120, 2),
      fakePayload(49200),
    ];
    const wrongPurpose = (): string => {
      const b = Uint8Array.from(
        atob(fakePayload().replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, 0))
          .split('')
          .map((c) => c.charCodeAt(0)),
      );
      b[2] = 0x02;
      return btoa(String.fromCharCode(...b))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    };
    bad.push(wrongPurpose());
    for (const payload of bad)
      expect((await putMemoryCall(h, cookie, newId(), { payload })).status).toBe(400);
    expect(rows(h.raw, 'SELECT 1 FROM memory')).toHaveLength(0);
  });

  it('el límite de 64 KiB lo marca el cuerpo (413) y la carga (400); nada se guarda', async () => {
    const { h, cookie } = await ready();
    const huge = await h.call('PUT', `/api/memories/${newId()}`, {
      cookie,
      rawBody: JSON.stringify({ payload: 'A'.repeat(80 * 1024), expected_revision: null }),
    });
    expect(huge.status).toBe(413);
    expect((await putMemoryCall(h, cookie, newId(), { payload: fakePayload(49200) })).status).toBe(
      400,
    );
    expect((await putMemoryCall(h, cookie, newId(), { payload: fakePayload(40000) })).status).toBe(
      200,
    ); // ~53 K caracteres: cabe
  });

  it('expected_revision y asset_ids mal formados: 400', async () => {
    const { h, cookie } = await ready();
    for (const over of [
      { expected_revision: 0 },
      { expected_revision: '1' },
      { expected_revision: 1.5 },
      { expected_revision: undefined },
      { asset_ids: 'x' },
      { asset_ids: ['no-id'] },
      {
        asset_ids: [
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
          newId(),
        ],
      },
      { schema_version: 0 },
    ]) {
      expect((await putMemoryCall(h, cookie, newId(), over)).status).toBe(400);
    }
    const dup = newId();
    expect((await putMemoryCall(h, cookie, newId(), { asset_ids: [dup, dup] })).status).toBe(400);
  });
});

describe('edición, revisiones y conflictos (PS-44)', () => {
  it('actualizar con la revisión correcta sube la revisión y updated_at', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putMemoryCall(h, cookie, id);
    h.clock.now += 60;
    const next = fakePayload(200);
    const r = await putMemoryCall(h, cookie, id, { payload: next, expected_revision: 1 });
    expect(r.json).toMatchObject({ revision: 2, created_at: T0, updated_at: T0 + 60 });
    expect(rows<{ payload: string }>(h.raw, 'SELECT payload FROM memory')[0]?.payload).toBe(next);
  });

  it('dos dispositivos con la misma revisión: el primero gana, el segundo recibe 409 con la versión del servidor', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putMemoryCall(h, cookie, id);
    const a = fakePayload(150);
    const b = fakePayload(160);
    expect((await putMemoryCall(h, cookie, id, { payload: a, expected_revision: 1 })).status).toBe(
      200,
    );
    const late = await putMemoryCall(h, cookie, id, { payload: b, expected_revision: 1 });
    expect(late.status).toBe(409);
    expect(late.json?.current).toMatchObject({ payload: a, revision: 2 });
    expect(rows<{ payload: string }>(h.raw, 'SELECT payload FROM memory')[0]?.payload).toBe(a);
  });

  it('dos escrituras simultáneas con la misma revisión: exactamente una se aplica', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putMemoryCall(h, cookie, id);
    const out = await Promise.all(
      Array.from({ length: 8 }, () =>
        putMemoryCall(h, cookie, id, { payload: fakePayload(130), expected_revision: 1 }),
      ),
    );
    expect(out.filter((r) => r.status === 200)).toHaveLength(1);
    expect(out.filter((r) => r.status === 409)).toHaveLength(7);
    expect(rows<{ revision: number }>(h.raw, 'SELECT revision FROM memory')[0]?.revision).toBe(2);
  });

  it('actualizar uno que no existe: 404; uno en papelera: 409 (primero hay que restaurarlo)', async () => {
    const { h, cookie } = await ready();
    expect((await putMemoryCall(h, cookie, newId(), { expected_revision: 1 })).status).toBe(404);
    const id = newId();
    await putMemoryCall(h, cookie, id);
    await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    expect((await putMemoryCall(h, cookie, id, { expected_revision: 2 })).status).toBe(409);
  });
});

describe('sincronización entre dispositivos', () => {
  it('?since devuelve solo lo cambiado; la paginación no se salta ni repite recuerdos con la misma hora', async () => {
    const { h, cookie } = await ready();
    const ids = Array.from({ length: 250 }, () => newId());
    for (const id of ids) await putMemoryCall(h, cookie, id); // todos con updated_at = T0
    const seen: string[] = [];
    let since = 0;
    let after = '';
    for (let i = 0; i < 10; i++) {
      const page = await h.call('GET', `/api/memories?since=${since}&after=${after}`, { cookie });
      for (const it of page.json?.items as { id: string }[]) seen.push(it.id);
      const next = page.json?.next as { since: number; after: string } | null;
      if (!next) break;
      since = next.since;
      after = next.after;
    }
    expect(new Set(seen).size).toBe(250);
    expect(seen).toHaveLength(250);
    h.clock.now += 100;
    await putMemoryCall(h, cookie, ids[3] as string, {
      expected_revision: 1,
      payload: fakePayload(140),
    });
    const delta = await h.call('GET', `/api/memories?since=${T0 + 1}`, { cookie });
    expect((delta.json?.items as { id: string }[]).map((x) => x.id)).toEqual([ids[3]]);
  });

  it('papelera: oculta por defecto, visible con trashed=1; trash y restore suben revisión para que otros dispositivos lo vean', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putMemoryCall(h, cookie, id);
    h.clock.now += 5;
    const t = await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    expect(t.json).toMatchObject({ revision: 2, deleted_at: T0 + 5 });
    expect(
      ((await h.call('GET', '/api/memories', { cookie })).json?.items as unknown[]).length,
    ).toBe(0);
    expect(
      ((await h.call('GET', '/api/memories?trashed=1', { cookie })).json?.items as unknown[])
        .length,
    ).toBe(1);
    h.clock.now += 5;
    const r = await h.call('POST', `/api/memories/${id}/restore`, { cookie });
    expect(r.json).toMatchObject({ revision: 3, deleted_at: null });
    expect(
      ((await h.call('GET', '/api/memories', { cookie })).json?.items as unknown[]).length,
    ).toBe(1);
  });

  it('trash/restore repetidos son idempotentes (no suben revisión); sobre uno inexistente, 404', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putMemoryCall(h, cookie, id);
    await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    const again = await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    expect(again.json).toMatchObject({ revision: 2 });
    expect((await h.call('POST', `/api/memories/${newId()}/restore`, { cookie })).status).toBe(404);
  });

  it('parámetros de lista inválidos: 400', async () => {
    const { h, cookie } = await ready();
    for (const q of ['since=-1', 'since=abc', 'since=1.5', 'after=' + 'a'.repeat(30), 'after=%00'])
      expect((await h.call('GET', `/api/memories?${q}`, { cookie })).status).toBe(400);
  });
});

describe('borrado definitivo', () => {
  it('solo desde la papelera; borra el recuerdo, sus fotos y miniaturas en D1 y en R2', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const photo = newId();
    const thumb = newId();
    expect((await putAssetCall(h, cookie, photo, 'photo', 3000)).status).toBe(201);
    expect((await putAssetCall(h, cookie, thumb, 'thumb', 500, `&parent=${photo}`)).status).toBe(
      201,
    );
    expect((await putMemoryCall(h, cookie, id, { asset_ids: [photo, thumb] })).status).toBe(200);
    expect(h.r2.store.size).toBe(2);
    expect((await h.call('DELETE', `/api/memories/${id}`, { cookie })).status).toBe(409); // visible: no se purga
    await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    const del = await h.call('DELETE', `/api/memories/${id}`, { cookie });
    expect(del.status).toBe(204);
    expect(rows(h.raw, 'SELECT 1 FROM memory')).toHaveLength(0);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
    expect(h.r2.store.size).toBe(0);
    expect((await h.call('GET', `/api/memories/${id}`, { cookie })).status).toBe(404);
    expect((await h.call('GET', `/api/assets/${photo}`, { cookie })).status).toBe(404);
  });

  it('si R2 falla durante el borrado no se pierde la referencia: las filas quedan `deleting` y la siguiente limpieza termina', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const photo = newId();
    await putAssetCall(h, cookie, photo, 'photo', 3000);
    await putMemoryCall(h, cookie, id, { asset_ids: [photo] });
    await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    const realDelete = h.r2.delete.bind(h.r2);
    h.r2.delete = async () => {
      throw new Error('R2 caído');
    };
    expect((await h.call('DELETE', `/api/memories/${id}`, { cookie })).status).toBe(500);
    expect(rows<{ state: string }>(h.raw, 'SELECT state FROM asset')[0]?.state).toBe('deleting');
    expect(rows(h.raw, 'SELECT 1 FROM memory')).toHaveLength(1);
    expect((await h.call('GET', `/api/assets/${photo}`, { cookie })).status).toBe(404); // ya no se sirve
    h.r2.delete = realDelete;
    expect((await h.call('DELETE', `/api/memories/${id}`, { cookie })).status).toBe(204); // reintento limpio
    expect(h.r2.store.size).toBe(0);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
  });

  it('papelera caducada (> 30 días): se purga sola al listar (limpieza perezosa)', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const photo = newId();
    await putAssetCall(h, cookie, photo, 'photo', 3000);
    await putMemoryCall(h, cookie, id, { asset_ids: [photo] });
    await h.call('POST', `/api/memories/${id}/trash`, { cookie });
    const keepSession = (): void =>
      void h.raw
        .prepare('UPDATE session SET expires_at = ?, last_seen_at = ?')
        .run(h.clock.now + 1000, h.clock.now);
    h.clock.now += 29 * 86400;
    keepSession();
    await h.call('GET', '/api/memories', { cookie });
    expect(rows(h.raw, 'SELECT 1 FROM memory')).toHaveLength(1); // aún dentro de los 30 días
    h.clock.now += 2 * 86400;
    keepSession();
    await h.call('GET', '/api/memories', { cookie });
    expect(rows(h.raw, 'SELECT 1 FROM memory')).toHaveLength(0);
    expect(h.r2.store.size).toBe(0);
  });
});

describe('tope de recuerdos', () => {
  it('con 20 000 recuerdos, el siguiente se rechaza con 507 y no se guarda', async () => {
    const { h, cookie } = await ready();
    const vault = rows<{ id: string }>(h.raw, 'SELECT id FROM vault')[0]?.id as string;
    h.raw.exec('BEGIN');
    const ins = h.raw.prepare(
      'INSERT INTO memory (id, vault_id, payload, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    );
    for (let i = 0; i < 20000; i++)
      ins.run(String(i).padStart(22, 'x'), vault, 'p'.repeat(40), T0, T0);
    h.raw.exec('COMMIT');
    const r = await putMemoryCall(h, cookie, newId());
    expect(r.status).toBe(507);
    expect(rows<{ n: number }>(h.raw, 'SELECT count(*) AS n FROM memory')[0]?.n).toBe(20000);
  });
});

describe('ligar fotos al recuerdo', () => {
  it('liga fotos y miniaturas pendientes (pasan a ready); la lista las muestra', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const photo = newId();
    const thumb = newId();
    await putAssetCall(h, cookie, photo, 'photo', 3000);
    await putAssetCall(h, cookie, thumb, 'thumb', 500, `&parent=${photo}`);
    expect((await h.call('GET', `/api/assets/${photo}`, { cookie })).status).toBe(404); // pendiente: aún no se sirve
    expect((await putMemoryCall(h, cookie, id, { asset_ids: [photo, thumb] })).status).toBe(200);
    const got = await h.call('GET', `/api/memories/${id}`, { cookie });
    const assets = got.json?.assets as { id: string; kind: string; parent_id: string | null }[];
    expect(assets.map((a) => a.id).sort()).toEqual([photo, thumb].sort());
    expect(assets.find((a) => a.id === thumb)?.parent_id).toBe(photo);
    expect(rows<{ state: string }>(h.raw, 'SELECT DISTINCT state FROM asset')).toEqual([
      { state: 'ready' },
    ]);
  });

  it('un recurso inexistente, ya ligado a OTRO recuerdo, avatar o miniatura sin su foto: 400 y no se guarda nada', async () => {
    const { h, cookie } = await ready();
    const a = newId();
    const photo = newId();
    await putAssetCall(h, cookie, photo, 'photo', 3000);
    await putMemoryCall(h, cookie, a, { asset_ids: [photo] });
    const avatar = newId();
    await putAssetCall(h, cookie, avatar, 'avatar', 1000);
    const lone = newId();
    const loneThumb = newId();
    await putAssetCall(h, cookie, lone, 'photo', 3000);
    await putAssetCall(h, cookie, loneThumb, 'thumb', 500, `&parent=${lone}`);
    for (const ids of [[newId()], [photo], [avatar], [loneThumb]]) {
      const b = newId();
      const r = await putMemoryCall(h, cookie, b, { asset_ids: ids });
      expect(r.status).toBe(400);
      expect(rows(h.raw, 'SELECT 1 FROM memory WHERE id = ?', b)).toHaveLength(0);
    }
    expect(
      rows<{ n: number }>(h.raw, "SELECT count(*) AS n FROM asset WHERE state = 'pending'")[0]?.n,
    ).toBe(2); // solo lone y loneThumb siguen pendientes (el avatar nace ready)
  });

  it('más de 5 fotos: 400', async () => {
    const { h, cookie } = await ready();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = newId();
      await putAssetCall(h, cookie, p, 'photo', 1000);
      ids.push(p);
    }
    expect((await putMemoryCall(h, cookie, newId(), { asset_ids: ids })).status).toBe(400);
  });

  it('al editar, la foto quitada se borra de R2 y de D1; la conservada sigue', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const keep = newId();
    const drop = newId();
    await putAssetCall(h, cookie, keep, 'photo', 3000);
    await putAssetCall(h, cookie, drop, 'photo', 3000);
    await putMemoryCall(h, cookie, id, { asset_ids: [keep, drop] });
    expect(h.r2.store.size).toBe(2);
    const r = await putMemoryCall(h, cookie, id, { expected_revision: 1, asset_ids: [keep] });
    expect(r.status).toBe(200);
    expect(rows<{ id: string }>(h.raw, 'SELECT id FROM asset').map((x) => x.id)).toEqual([keep]);
    expect(h.r2.store.size).toBe(1);
  });

  it('dos recuerdos que intentan ligar la MISMA foto a la vez: solo uno lo consigue', async () => {
    const { h, cookie } = await ready();
    const photo = newId();
    await putAssetCall(h, cookie, photo, 'photo', 3000);
    const out = await Promise.all([
      putMemoryCall(h, cookie, newId(), { asset_ids: [photo] }),
      putMemoryCall(h, cookie, newId(), { asset_ids: [photo] }),
    ]);
    expect(out.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rows<{ n: number }>(h.raw, 'SELECT count(*) AS n FROM memory')[0]?.n).toBe(1);
  });
});

describe('otra cuenta (PS-04)', () => {
  it('un recuerdo y una foto de otro vault dan el MISMO 404 que uno inexistente, y no se pueden tocar', async () => {
    const { h, cookie } = await ready();
    h.raw.exec('PRAGMA foreign_keys = OFF');
    const alien = newId();
    const alienAsset = newId();
    h.raw
      .prepare(
        'INSERT INTO memory (id, vault_id, payload, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(alien, newId(), 'p'.repeat(40), T0, T0);
    h.raw
      .prepare(
        "INSERT INTO asset (id, vault_id, memory_id, kind, r2_key, size_bytes, state, created_at) VALUES (?, ?, ?, 'photo', ?, 100, 'ready', ?)",
      )
      .run(alienAsset, newId(), alien, 'k'.repeat(43), T0);
    h.r2.store.set('k'.repeat(43), fakeAsset(100));
    const missing = await h.call('GET', `/api/memories/${newId()}`, { cookie });
    for (const [m, p] of [
      ['GET', `/api/memories/${alien}`],
      ['POST', `/api/memories/${alien}/trash`],
      ['POST', `/api/memories/${alien}/restore`],
      ['DELETE', `/api/memories/${alien}`],
      ['GET', `/api/assets/${alienAsset}`],
      ['DELETE', `/api/assets/${alienAsset}`],
    ] as const) {
      const r = await h.call(m, p, { cookie });
      expect(r.status).toBe(404);
      expect(r.json).toEqual(missing.json);
    }
    expect((await putMemoryCall(h, cookie, alien, { expected_revision: 1 })).status).toBe(404);
    expect(
      ((await h.call('GET', '/api/memories?trashed=1', { cookie })).json?.items as unknown[])
        .length,
    ).toBe(0);
    expect((await putMemoryCall(h, cookie, newId(), { asset_ids: [alienAsset] })).status).toBe(400);
    expect(h.r2.store.size).toBe(1);
  });
});

describe('trash/restore con revisión esperada (contrato del repositorio)', () => {
  it('con expected_revision: revisión distinta o ya en ese estado → 409 con la versión actual; correcta → se aplica', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putMemoryCall(h, cookie, id);
    const bad = await h.call('POST', `/api/memories/${id}/trash`, {
      cookie,
      body: { expected_revision: 7 },
    });
    expect(bad.status).toBe(409);
    expect((bad.json?.current as { revision: number }).revision).toBe(1);
    expect(
      (
        await h.call('POST', `/api/memories/${id}/restore`, {
          cookie,
          body: { expected_revision: 1 },
        })
      ).status,
    ).toBe(409); // ya visible
    const ok = await h.call('POST', `/api/memories/${id}/trash`, {
      cookie,
      body: { expected_revision: 1 },
    });
    expect(ok.json).toMatchObject({ revision: 2 });
    expect(
      (
        await h.call('POST', `/api/memories/${id}/trash`, {
          cookie,
          body: { expected_revision: 2 },
        })
      ).status,
    ).toBe(409); // ya en papelera
    for (const expected_revision of [0, 'x', 1.5])
      expect(
        (await h.call('POST', `/api/memories/${id}/trash`, { cookie, body: { expected_revision } }))
          .status,
      ).toBe(400);
  });

  it('el listado incluye created_at de cada recurso', async () => {
    const { h, cookie } = await ready();
    const photo = newId();
    await putAssetCall(h, cookie, photo, 'photo', 800);
    const id = newId();
    await putMemoryCall(h, cookie, id, { asset_ids: [photo] });
    const got = await h.call('GET', `/api/memories/${id}`, { cookie });
    expect((got.json?.assets as { created_at: number }[])[0]?.created_at).toBe(T0);
  });
});
