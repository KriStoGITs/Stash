import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stash-test-'));
process.env.DATA_DIR = join(temporaryDirectory, 'app');

const { server } = await import('../server.js');
const { db, transaction } = await import('../lib/database.js');
const { hash, verify } = await import('../lib/passwords.js');
const { readForm } = await import('../lib/http.js');
const { integer } = await import('../lib/validation.js');
const password = 'WarehouseTest123';

await test('STASH application', async suite => {
  const accounts = {};
  for (const role of ['admin', 'worker', 'sorter']) {
    const result = db.prepare(
      'INSERT INTO users(name, email, password, role) VALUES (?, ?, ?, ?)',
    ).run(role, `${role}@example.com`, hash(password), role);
    accounts[role] = Number(result.lastInsertRowid);
  }

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  suite.after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    db.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  async function request(path, { session, data, method, cookie } = {}) {
    const headers = {};
    if (session || cookie) headers.Cookie = cookie || session.cookie;
    if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const response = await fetch(baseUrl + path, {
      method: method || (data ? 'POST' : 'GET'),
      headers,
      body: data ? new URLSearchParams(data) : undefined,
      redirect: 'manual',
    });

    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    };
  }

  async function login(role, loginPassword = password) {
    const page = await request('/login');
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    const csrf = page.body.match(/name="csrf" value="([^"]+)"/)[1];
    const response = await request('/login', {
      cookie,
      data: { csrf, email: `${role}@example.com`, password: loginPassword },
    });

    assert.equal(response.status, 303);
    const sessionCookie = response.headers.getSetCookie()[0].split(';')[0];
    const token = sessionCookie.slice('sid='.length);
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    return { cookie: sessionCookie, csrf: session.csrf, token };
  }

  const admin = await login('admin');
  const worker = await login('worker');
  const sorter = await login('sorter');

  function post(path, session, data = {}) {
    return request(path, { session, data: { csrf: session.csrf, ...data } });
  }

  await suite.test('anonymous requests redirect and responses carry security headers', async () => {
    const response = await request('/');
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);

    const stylesheet = await request('/style.css');
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers.get('content-type'), 'text/css');
    assert.match(stylesheet.body, /@media/);
  });

  await suite.test('login rejects a missing CSRF token', async () => {
    const response = await request('/login', {
      data: { email: 'admin@example.com', password },
    });
    assert.equal(response.status, 403);
  });

  await suite.test('authenticated POST requests require their session CSRF token', async () => {
    const response = await request('/products/save', {
      session: admin,
      data: { csrf: 'invalid', sku: 'TEST', name: 'Test', quantity: '1' },
    });
    assert.equal(response.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 0);
  });

  await suite.test('roles control product changes and user administration', async () => {
    assert.equal((await post('/products/save', sorter)).status, 403);
    assert.equal((await request('/users', { session: worker })).status, 403);
    assert.equal((await request('/users', { session: sorter })).status, 403);
    assert.equal((await request('/products/new', { session: worker })).status, 200);
    assert.equal((await request('/products', { session: sorter })).status, 200);
  });

  await suite.test('workers can create and edit products; listing escapes user content', async () => {
    assert.equal((await post('/products/save', worker, {
      sku: 'BOX_01', name: '<script>test</script>', quantity: '7',
    })).status, 303);

    const product = db.prepare('SELECT * FROM products WHERE sku = ?').get('BOX_01');
    assert.equal(product.quantity, 7);
    assert.equal(product.condition, 'Labs');

    const listing = await request('/products?q=BOX_01', { session: sorter });
    assert.match(listing.body, /&lt;script&gt;test&lt;\/script&gt;/);
    assert.doesNotMatch(listing.body, /<script>/);

    assert.equal((await post('/products/save', worker, {
      id: product.id, sku: 'BOX_01', name: 'Kaste', quantity: '12',
    })).status, 303);
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id = ?').get(product.id).quantity, 12);

    const dashboard = await request('/', { session: admin });
    assert.match(dashboard.body, /<strong>12<\/strong>/);
  });

  await suite.test('invalid quantities and missing products leave data unchanged', async () => {
    assert.equal((await post('/products/save', worker, {
      sku: 'BAD', name: 'Invalid', quantity: '-1',
    })).status, 400);
    assert.equal((await request('/products/edit?id=9999', { session: admin })).status, 404);
    assert.equal((await post('/products/save', worker, {
      id: '9999', sku: 'BAD', name: 'Missing', quantity: '1',
    })).status, 404);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 1);
  });

  await suite.test('duplicate SKUs roll back without writing an audit entry', async () => {
    const countBefore = db.prepare('SELECT COUNT(*) AS count FROM audit').get().count;
    const response = await post('/products/save', admin, {
      sku: 'box_01', name: 'Duplicate', quantity: '1',
    });
    assert.equal(response.status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit').get().count, countBefore);
  });

  await suite.test('only administrators can delete products', async () => {
    const product = db.prepare('SELECT id FROM products').get();
    assert.equal((await post('/products/delete', worker, { id: product.id })).status, 403);
    assert.equal((await post('/products/delete', admin, { id: product.id })).status, 303);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 0);
  });

  await suite.test('administrators create users with validated roles and passwords', async () => {
    const fields = {
      name: 'Jauns lietotājs', email: 'NEW@example.com', role: 'worker',
      password: 'NewAccount1234',
    };
    assert.equal((await post('/users/save', admin, {
      ...fields, password: 'weak',
    })).status, 400);
    assert.equal((await post('/users/save', admin, {
      ...fields, role: 'unknown',
    })).status, 400);
    assert.equal((await post('/users/save', admin, fields)).status, 303);

    const created = db.prepare('SELECT * FROM users WHERE email = ?').get('new@example.com');
    assert.equal(created.role, 'worker');
    assert.ok(verify(fields.password, created.password));
    assert.notEqual(created.password, fields.password);
  });

  await suite.test('editing a user preserves a blank password and invalidates sessions', async () => {
    const previous = db.prepare('SELECT * FROM users WHERE id = ?').get(accounts.worker);
    assert.equal((await post('/users/save', admin, {
      id: previous.id, name: 'Updated worker', email: previous.email,
      role: 'sorter', password: '',
    })).status, 303);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(previous.id);
    assert.equal(updated.password, previous.password);
    assert.equal(updated.role, 'sorter');
    assert.equal((await request('/products', { session: worker })).status, 303);
  });

  await suite.test('administrators cannot delete or demote their own account', async () => {
    assert.equal((await post('/users/delete', admin, { id: accounts.admin })).status, 400);
    assert.equal((await post('/users/save', admin, {
      id: accounts.admin, name: 'Admin', email: 'admin@example.com',
      role: 'worker', password: '',
    })).status, 400);
  });

  await suite.test('deleting another account removes its sessions', async () => {
    assert.equal((await post('/users/delete', admin, { id: accounts.sorter })).status, 303);
    assert.equal(db.prepare('SELECT id FROM users WHERE id = ?').get(accounts.sorter), undefined);
    assert.equal((await request('/products', { session: sorter })).status, 303);
  });

  await suite.test('expired sessions, unsupported methods and unknown routes', async () => {
    const expired = await login('admin');
    db.prepare('UPDATE sessions SET expires = 0 WHERE token = ?').run(expired.token);
    assert.equal((await request('/', { session: expired })).status, 303);
    assert.equal((await request('/', { method: 'PUT' })).status, 405);
    assert.equal((await request('/missing', { session: admin })).status, 404);

    const response = await fetch(baseUrl + '/products/save', {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 415);
    await response.text();
  });

  await suite.test('logout clears the session', async () => {
    assert.equal((await post('/logout', admin)).status, 303);
    assert.equal(db.prepare('SELECT token FROM sessions WHERE token = ?').get(admin.token), undefined);
    assert.equal((await request('/', { session: admin })).status, 303);
  });

  await suite.test('five failed logins trigger the rate limit', async () => {
    const page = await request('/login');
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    const csrf = page.body.match(/name="csrf" value="([^"]+)"/)[1];
    const data = { csrf, email: 'admin@example.com', password: 'wrong' };

    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await request('/login', { cookie, data })).status, 401);
    }
    assert.equal((await request('/login', { cookie, data })).status, 429);
  });

  await suite.test('form parsing preserves UTF-8 across chunks and enforces the size limit', async () => {
    const bytes = Buffer.from('name=ā');
    const request = Readable.from([bytes.subarray(0, 6), bytes.subarray(6)]);
    request.headers = { 'content-type': 'application/x-www-form-urlencoded' };
    assert.equal((await readForm(request)).get('name'), 'ā');

    const oversized = Readable.from([Buffer.alloc(32_769)]);
    oversized.headers = request.headers;
    await assert.rejects(readForm(oversized), { status: 413 });
  });

  await suite.test('transaction rollback, integer validation, and salted passwords', () => {
    assert.throws(() => transaction(() => {
      db.prepare('INSERT INTO products(sku, name) VALUES (?, ?)').run('ROLLBACK', 'Temporary');
      throw new Error('cancel');
    }), /cancel/);
    assert.equal(db.prepare('SELECT id FROM products WHERE sku = ?').get('ROLLBACK'), undefined);
    assert.throws(() => integer('1.5'), { status: 400 });
    assert.throws(() => integer('1000001'), { status: 400 });
    assert.equal(integer('0'), 0);
    assert.notEqual(hash(password), hash(password));
    assert.equal(verify('wrong', hash(password)), false);
  });

  await suite.test('setup creates three accounts and refuses a second run', () => {
    const env = { ...process.env, DATA_DIR: join(temporaryDirectory, 'setup') };
    const setupFile = new URL('../setup.js', import.meta.url);
    const first = spawnSync(process.execPath, [fileURLToPath(setupFile)], {
      env, encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    for (const email of ['admin@stash.lv', 'worker@stash.lv', 'sorter@stash.lv']) {
      assert.ok(first.stdout.includes(email));
    }

    const second = spawnSync(process.execPath, [fileURLToPath(setupFile)], {
      env, encoding: 'utf8',
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /Konti jau izveidoti/);
  });
});
