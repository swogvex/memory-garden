import { describe, expect, it } from 'vitest';
import { rows } from './_d1';
import {
  T0,
  doSetup,
  fakeAsset,
  makeHarness,
  newId,
  putAssetCall,
  putMemoryCall,
} from './_support';

/** H7.2 · fotos: subida, lectura, borrado, límites, abuso y cortes de conexión (PS-04, PS-38, PS-42, PS-44, PS-61). */
async function ready() {
  const h = makeHarness();
  const { cookie } = await doSetup(h);
  return { h, cookie };
}
const MiB = 1024 * 1024;

describe('subir y leer', () => {
  it('subir deja la fila pending y el objeto en R2 con clave aleatoria; no se sirve hasta ligarlo a un recuerdo', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const bytes = fakeAsset(5000);
    const up = await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes });
    expect(up.status).toBe(201);
    const row = rows<{
      r2_key: string;
      state: string;
      size_bytes: number;
      memory_id: string | null;
    }>(h.raw, 'SELECT r2_key, state, size_bytes, memory_id FROM asset')[0];
    expect(row).toMatchObject({ state: 'pending', size_bytes: 5000, memory_id: null });
    expect(row?.r2_key).toHaveLength(43);
    expect(row?.r2_key).not.toContain(id);
    expect(h.r2.store.get(row?.r2_key as string)).toEqual(bytes);
    expect((await h.call('GET', `/api/assets/${id}`, { cookie })).status).toBe(404);
  });

  it('ligado a un recuerdo, GET devuelve los mismos bytes con las cabeceras de una descarga cifrada privada', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const bytes = fakeAsset(5000);
    await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes });
    await putMemoryCall(h, cookie, newId(), { asset_ids: [id] });
    const got = await h.call('GET', `/api/assets/${id}`, { cookie });
    expect(got.status).toBe(200);
    expect(got.bytes).toEqual(bytes);
    expect(got.headers.get('Cache-Control')).toBe('private, no-store');
    expect(got.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(got.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(got.headers.get('Content-Length')).toBe('5000');
    expect(got.headers.get('Accept-Ranges')).toBe('none');
    expect(got.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(got.headers.get('Content-Disposition')).toBeNull();
  });

  it('con Range, el servidor ignora el rango y devuelve el objeto completo (sin 206)', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes: fakeAsset(5000) });
    await putMemoryCall(h, cookie, newId(), { asset_ids: [id] });
    const got = await h.call('GET', `/api/assets/${id}`, {
      cookie,
      headers: { Range: 'bytes=0-10' },
    });
    expect(got.status).toBe(200);
    expect(got.bytes.length).toBe(5000);
  });

  it('sin sesión: 401 en subida, lectura y borrado; ni R2 ni D1 se tocan', async () => {
    const { h } = await ready();
    const id = newId();
    for (const r of [
      h.call('PUT', `/api/assets/${id}?kind=photo`, { bytes: fakeAsset(500) }),
      h.call('GET', `/api/assets/${id}`),
      h.call('DELETE', `/api/assets/${id}`),
    ])
      expect((await r).status).toBe(401);
    expect(h.r2.puts).toHaveLength(0);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
  });

  it('objeto desaparecido de R2 pero con fila ready: 404 (no revela la causa) y sin detalle de error', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes: fakeAsset(500) });
    await putMemoryCall(h, cookie, newId(), { asset_ids: [id] });
    h.r2.store.clear();
    const r = await h.call('GET', `/api/assets/${id}`, { cookie });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found' });
  });

  it('un objeto manipulado en R2 se devuelve tal cual (el servidor no lo abre): lo detecta el cliente con AES-GCM', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes: fakeAsset(500) });
    await putMemoryCall(h, cookie, newId(), { asset_ids: [id] });
    const key = rows<{ r2_key: string }>(h.raw, 'SELECT r2_key FROM asset')[0]?.r2_key as string;
    const tampered = new Uint8Array(h.r2.store.get(key) as Uint8Array);
    tampered[100] ^= 0xff;
    h.r2.store.set(key, tampered);
    expect((await h.call('GET', `/api/assets/${id}`, { cookie })).bytes).toEqual(tampered);
  });
});

describe('tamaño y forma de la subida (PS-38)', () => {
  it('sin Content-Length: 411 sin leer el cuerpo; Content-Length absurdo: 400', async () => {
    const { h, cookie } = await ready();
    expect(
      (
        await h.call('PUT', `/api/assets/${newId()}?kind=photo`, {
          cookie,
          bytes: fakeAsset(500),
          length: null,
        })
      ).status,
    ).toBe(411);
    for (const length of ['abc', '-5', '1e3', '0x10', '99999999999']) {
      expect(
        (
          await h.call('PUT', `/api/assets/${newId()}?kind=photo`, {
            cookie,
            bytes: fakeAsset(500),
            headers: { 'Content-Length': length },
          })
        ).status,
      ).toBe(length === '99999999999' ? 400 : 400);
    }
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
  });

  it('por encima del límite de su tipo: 413 declarando el tamaño, antes de leer', async () => {
    const { h, cookie } = await ready();
    let read = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        read = true;
        c.enqueue(new Uint8Array(1000));
      },
    });
    const big = await h.call('PUT', `/api/assets/${newId()}?kind=photo`, {
      cookie,
      stream,
      length: 2 * MiB + 1,
    });
    expect(big.status).toBe(413);
    void read;
    expect(
      (await putAssetCall(h, cookie, newId(), 'thumb', 256 * 1024 + 1, `&parent=${newId()}`))
        .status,
    ).toBe(413);
    expect((await putAssetCall(h, cookie, newId(), 'avatar', 128 * 1024 + 1)).status).toBe(413);
    expect((await putAssetCall(h, cookie, newId(), 'photo', 2 * MiB)).status).toBe(201); // justo en el límite
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(1);
  });

  it('demasiado pequeño para ser un sobre: 400', async () => {
    const { h, cookie } = await ready();
    expect((await putAssetCall(h, cookie, newId(), 'photo', 31)).status).toBe(400);
    expect((await putAssetCall(h, cookie, newId(), 'photo', 32)).status).toBe(201);
  });

  it('cuerpo más largo o más corto de lo declarado: 400 y no se guarda nada (ni fila ni objeto)', async () => {
    const { h, cookie } = await ready();
    expect(
      (
        await h.call('PUT', `/api/assets/${newId()}?kind=photo`, {
          cookie,
          bytes: fakeAsset(1000),
          length: 500,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call('PUT', `/api/assets/${newId()}?kind=photo`, {
          cookie,
          bytes: fakeAsset(1000),
          length: 2000,
        })
      ).status,
    ).toBe(400);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
    expect(h.r2.puts).toHaveLength(0);
  });

  it('conexión perdida a mitad de subida: no queda fila ni objeto, y reintentar con el mismo id funciona', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const bytes = fakeAsset(4000);
    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 1500));
      },
      pull() {
        throw new Error('conexión cortada');
      },
    });
    const cut = await h.call('PUT', `/api/assets/${id}?kind=photo`, {
      cookie,
      stream: broken,
      length: 4000,
    });
    expect([400, 500]).toContain(cut.status);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
    expect(h.r2.puts).toHaveLength(0);
    expect((await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes })).status).toBe(
      201,
    );
  });

  it('sobre con cabecera ajena (finalidad de datos, versión de formato, mk_version distinta, sin cabecera): 400', async () => {
    const { h, cookie } = await ready();
    const mk = (patch: number[]): Uint8Array => {
      const b = fakeAsset(300);
      b.set(patch);
      return b;
    };
    for (const bytes of [
      mk([1, 1, 1, 1]),
      mk([2, 1, 2, 1]),
      mk([1, 2, 2, 1]),
      mk([1, 1, 2, 2]),
      mk([1, 1, 2, 0]),
      new Uint8Array(300),
    ]) {
      expect(
        (await h.call('PUT', `/api/assets/${newId()}?kind=photo`, { cookie, bytes })).status,
      ).toBe(400);
    }
    expect(h.r2.puts).toHaveLength(0);
  });

  it('parámetros inválidos: id, kind, parent', async () => {
    const { h, cookie } = await ready();
    const photo = newId();
    await putAssetCall(h, cookie, photo, 'photo');
    for (const path of [
      `/api/assets/corto?kind=photo`,
      `/api/assets/${newId()}`,
      `/api/assets/${newId()}?kind=video`,
      `/api/assets/${newId()}?kind=thumb`,
      `/api/assets/${newId()}?kind=thumb&parent=corto`,
      `/api/assets/${newId()}?kind=photo&parent=${photo}`,
      `/api/assets/${newId()}?kind=thumb&parent=${newId()}`,
    ]) {
      expect((await h.call('PUT', path, { cookie, bytes: fakeAsset(300) })).status).toBe(400);
    }
    // una miniatura no puede colgar de otra miniatura ni de un avatar
    const thumb = newId();
    await putAssetCall(h, cookie, thumb, 'thumb', 300, `&parent=${photo}`);
    expect((await putAssetCall(h, cookie, newId(), 'thumb', 300, `&parent=${thumb}`)).status).toBe(
      400,
    );
  });

  it('id repetido: 409 y el objeto original NO se pisa', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const first = fakeAsset(400);
    await h.call('PUT', `/api/assets/${id}?kind=photo`, { cookie, bytes: first });
    expect((await putAssetCall(h, cookie, id, 'photo', 500)).status).toBe(409);
    expect(h.r2.store.size).toBe(1);
    expect([...h.r2.store.values()][0]).toEqual(first);
  });
});

describe('cuotas y abuso (PS-61)', () => {
  it('como mucho 12 subidas sin ligar: la 13.ª recibe 429 con Retry-After; ligar libera hueco', async () => {
    const { h, cookie } = await ready();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = newId();
      ids.push(id);
      expect((await putAssetCall(h, cookie, id, 'photo', 300)).status).toBe(201);
    }
    const over = await putAssetCall(h, cookie, newId(), 'photo', 300);
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe('60');
    expect(h.r2.store.size).toBe(12);
    await putMemoryCall(h, cookie, newId(), { asset_ids: ids.slice(0, 5) });
    expect((await putAssetCall(h, cookie, newId(), 'photo', 300)).status).toBe(201);
  });

  it('200 MiB al día: lo superado da 429; pasadas 24 h vuelve a permitirse', async () => {
    const { h, cookie } = await ready();
    const vault = rows<{ id: string }>(h.raw, 'SELECT id FROM vault')[0]?.id as string;
    h.raw
      .prepare(
        "INSERT INTO asset (id, vault_id, kind, r2_key, size_bytes, state, created_at, memory_id) VALUES (?, ?, 'avatar', ?, ?, 'ready', ?, NULL)",
      )
      .run(newId(), vault, 'b'.repeat(43), 4 * MiB, T0);
    for (let i = 0; i < 49; i++)
      h.raw
        .prepare(
          "INSERT INTO asset (id, vault_id, kind, r2_key, size_bytes, state, created_at, memory_id) VALUES (?, ?, 'avatar', ?, ?, 'ready', ?, NULL)",
        )
        .run(newId(), vault, String(i).padStart(43, 'c'), 4 * MiB, T0);
    // 50 × 4 MiB = 200 MiB hoy
    const r = await putAssetCall(h, cookie, newId(), 'avatar', 1000);
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('3600');
    h.clock.now += 86400 + 1;
    h.raw
      .prepare('UPDATE session SET expires_at = ?, last_seen_at = ?')
      .run(h.clock.now + 100, h.clock.now);
    expect((await putAssetCall(h, cookie, newId(), 'avatar', 1000)).status).toBe(201);
  });

  it('5 GiB totales: lo que lo supera da 507 y no deja fila ni objeto', async () => {
    const { h, cookie } = await ready();
    const vault = rows<{ id: string }>(h.raw, 'SELECT id FROM vault')[0]?.id as string;
    const ins = h.raw.prepare(
      "INSERT INTO asset (id, vault_id, kind, r2_key, size_bytes, state, created_at) VALUES (?, ?, 'avatar', ?, 4194304, 'ready', ?)",
    );
    h.raw.exec('BEGIN');
    for (let i = 0; i < 1281; i++)
      ins.run(newId(), vault, String(i).padStart(43, 'e'), T0 - 10 * 86400); // 1281 × 4 MiB > 5 GiB
    h.raw.exec('COMMIT');
    const before = h.r2.store.size;
    expect((await putAssetCall(h, cookie, newId(), 'photo', 1000)).status).toBe(507);
    expect(h.r2.store.size).toBe(before);
  });

  it('carrera: 30 subidas simultáneas sin ligar no superan las 12 permitidas', async () => {
    const { h, cookie } = await ready();
    const out = await Promise.all(
      Array.from({ length: 30 }, () => putAssetCall(h, cookie, newId(), 'photo', 300)),
    );
    expect(out.filter((r) => r.status === 201)).toHaveLength(12);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(12);
  });
});

describe('fallos de R2 y limpieza', () => {
  it('si R2 falla al guardar: 500 genérico y se deshace la reserva (ni fila ni objeto)', async () => {
    const { h, cookie } = await ready();
    h.r2.failPut = true;
    const r = await putAssetCall(h, cookie, newId(), 'photo', 500);
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: 'server_error' });
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
    h.r2.failPut = false;
    expect((await putAssetCall(h, cookie, newId(), 'photo', 500)).status).toBe(201);
  });

  it('si R2 falla al leer: 500 genérico, sin detalle', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putAssetCall(h, cookie, id, 'photo', 500);
    await putMemoryCall(h, cookie, newId(), { asset_ids: [id] });
    h.r2.failGet = true;
    const r = await h.call('GET', `/api/assets/${id}`, { cookie });
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('R2');
  });

  it('subidas pending abandonadas (> 1 h) se barren solas en la siguiente subida: fila y objeto', async () => {
    const { h, cookie } = await ready();
    const stale = newId();
    await putAssetCall(h, cookie, stale, 'photo', 500);
    h.clock.now += 3601;
    h.raw
      .prepare('UPDATE session SET expires_at = ?, last_seen_at = ?')
      .run(h.clock.now + 100, h.clock.now);
    expect((await putAssetCall(h, cookie, newId(), 'photo', 500)).status).toBe(201);
    expect(rows(h.raw, 'SELECT 1 FROM asset WHERE id = ?', stale)).toHaveLength(0);
    expect(h.r2.store.size).toBe(1);
  });

  it('una subida pendiente reciente NO se barre', async () => {
    const { h, cookie } = await ready();
    const keep = newId();
    await putAssetCall(h, cookie, keep, 'photo', 500);
    h.clock.now += 3000;
    h.raw
      .prepare('UPDATE session SET expires_at = ?, last_seen_at = ?')
      .run(h.clock.now + 100, h.clock.now);
    await putAssetCall(h, cookie, newId(), 'photo', 500);
    expect(rows(h.raw, 'SELECT 1 FROM asset WHERE id = ?', keep)).toHaveLength(1);
  });
});

describe('borrar un recurso', () => {
  it('una subida sin ligar se puede cancelar (y su miniatura con ella): fila y objeto desaparecen', async () => {
    const { h, cookie } = await ready();
    const photo = newId();
    const thumb = newId();
    await putAssetCall(h, cookie, photo, 'photo', 800);
    await putAssetCall(h, cookie, thumb, 'thumb', 300, `&parent=${photo}`);
    expect((await h.call('DELETE', `/api/assets/${photo}`, { cookie })).status).toBe(204);
    expect(rows(h.raw, 'SELECT 1 FROM asset')).toHaveLength(0);
    expect(h.r2.store.size).toBe(0);
  });

  it('uno ya ligado a un recuerdo no se borra suelto (409): se quita editando el recuerdo', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    await putAssetCall(h, cookie, id, 'photo', 800);
    await putMemoryCall(h, cookie, newId(), { asset_ids: [id] });
    expect((await h.call('DELETE', `/api/assets/${id}`, { cookie })).status).toBe(409);
    expect(h.r2.store.size).toBe(1);
  });

  it('el avatar se sirve sin recuerdo y se puede borrar', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const bytes = fakeAsset(900);
    await h.call('PUT', `/api/assets/${id}?kind=avatar`, { cookie, bytes });
    expect((await h.call('GET', `/api/assets/${id}`, { cookie })).bytes).toEqual(bytes);
    expect((await h.call('DELETE', `/api/assets/${id}`, { cookie })).status).toBe(204);
    expect((await h.call('GET', `/api/assets/${id}`, { cookie })).status).toBe(404);
    expect(h.r2.store.size).toBe(0);
  });
});

describe('higiene (PS-42)', () => {
  it('los logs de error no incluyen rutas, ids, claves de R2 ni cuerpos', async () => {
    const { h, cookie } = await ready();
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    try {
      h.r2.failPut = true;
      const id = newId();
      await putAssetCall(h, cookie, id, 'photo', 500);
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) expect(line).toMatch(/^mg:error \w+$/);
    } finally {
      console.error = orig;
    }
  });

  it('ninguna respuesta de estas rutas es cacheable ni lleva Set-Cookie nuevo', async () => {
    const { h, cookie } = await ready();
    const id = newId();
    const rs = [
      await putAssetCall(h, cookie, id, 'photo', 500),
      await putMemoryCall(h, cookie, newId(), { asset_ids: [id] }),
      await h.call('GET', '/api/memories', { cookie }),
      await h.call('GET', `/api/assets/${id}`, { cookie }),
    ];
    for (const r of rs) {
      expect(r.headers.get('Cache-Control')).toMatch(/no-store/);
      expect(r.cookies).toHaveLength(0);
    }
  });
});
