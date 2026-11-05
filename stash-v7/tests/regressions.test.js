import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readFormBody, MAX_BODY_BYTES } from '../lib/http.js';
import { hash, verify } from '../lib/passwords.js';

const temp = mkdtempSync(join(tmpdir(), 'stash-regressions-'));
process.env.DATA_DIR = temp;
const { db } = await import('../core.js');
const { server } = await import('../server.js');
const password = 'TestPassword123!';
for (const role of ['admin', 'worker', 'sorter']) {
  db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(
    role,
    `${role}@stash.lv`,
    hash(password),
    role,
  );
}
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

beforeEach(() => db.prepare('DELETE FROM login_limits').run());
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(temp, { recursive: true, force: true });
});

function session(role = 'admin') {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  const user = db.prepare('SELECT id FROM users WHERE role=?').get(role);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(token, user.id, csrf, Date.now() + 60000);
  return { token, csrf, cookie: `sid=${token}` };
}

async function request(path, account, data, extra = {}) {
  const headers = account ? { cookie: account.cookie } : {};
  const options = { redirect: 'manual', headers, ...extra };
  if (data) {
    options.method = 'POST';
    headers['content-type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams({ csrf: account?.csrf || '', ...data });
  }
  const response = await fetch(base + path, options);
  return { status: response.status, headers: response.headers, html: await response.text() };
}

async function loginForm(account) {
  const page = await request('/login', account);
  const csrf = [...page.html.matchAll(/name="csrf" value="([^"]+)"/g)].at(-1)[1];
  const loginCookie = page.headers.getSetCookie()[0].split(';')[0];
  return { csrf, cookie: [account?.cookie, loginCookie].filter(Boolean).join('; ') };
}

function formStream(chunks, contentType = 'application/x-www-form-urlencoded') {
  const stream = (async function* () {
    yield* chunks;
  })();
  stream.headers = { 'content-type': contentType };
  return stream;
}

test('UTF-8 characters survive every possible request chunk boundary', async () => {
  const name = 'Skrūves — Rīga';
  const bytes = Buffer.from(`name=${name}`);
  for (let split = 1; split < bytes.length; split++) {
    const data = await readFormBody(formStream([bytes.subarray(0, split), bytes.subarray(split)]));
    assert.equal(data.get('name'), name);
  }
});

test('The form size limit counts bytes and rejects oversized bodies', async () => {
  const allowed = Buffer.from('x=' + 'a'.repeat(MAX_BODY_BYTES - 2));
  assert.equal((await readFormBody(formStream([allowed]))).get('x').length, MAX_BODY_BYTES - 2);
  await assert.rejects(readFormBody(formStream([allowed, Buffer.from('ā')])), { status: 413 });
});

test('Content type accepts parameters and rejects invalid prefix matches', async () => {
  const data = await readFormBody(
    formStream([Buffer.from('name=R%C4%ABga')], 'Application/X-WWW-Form-Urlencoded; charset=UTF-8'),
  );
  assert.equal(data.get('name'), 'Rīga');
  await assert.rejects(
    readFormBody(formStream([], 'application/x-www-form-urlencoded-incorrect')),
    { status: 415 },
  );
});

test('Malformed password records fail verification without crashing', () => {
  for (const stored of [null, '', 'bad', 'salt:00', 'a'.repeat(32) + ':' + 'z'.repeat(128)]) {
    assert.equal(verify(password, stored), false);
  }
  const stored = hash(password);
  assert.equal(verify(password, stored), true);
  assert.equal(verify('wrong', stored), false);
});

test('Sorter home hides order counts and worker navigation includes product creation', async () => {
  const sorter = await request('/', session('sorter'));
  assert.equal(sorter.status, 200);
  assert.ok(!sorter.html.includes('Aktīvi pasūtījumi'));
  const worker = await request('/', session('worker'));
  assert.ok(worker.html.includes('Aktīvi pasūtījumi'));
  assert.ok(worker.html.includes('href="/products/new"'));
});

test('Similar URL prefixes return 404 instead of entering another module', async () => {
  const account = session('sorter');
  for (const path of ['/users-extra', '/orders-extra', '/products-extra', '/placement-extra']) {
    assert.equal((await request(path, account)).status, 404);
  }
});

test('HTTP server returns useful errors for oversized and unsupported requests', async () => {
  assert.equal(
    (await request('/products/save', session(), { name: 'a'.repeat(MAX_BODY_BYTES) })).status,
    413,
  );
  assert.equal(
    (
      await request('/products/save', session(), null, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal((await request('/', session(), null, { method: 'DELETE' })).status, 405);
  assert.equal((await request('/reports', session(), {})).status, 405);
});

test(
  'Revoking a session during a slow POST prevents the pending change',
  { timeout: 5000 },
  async () => {
    const account = session();
    const body = new URLSearchParams({
      csrf: account.csrf,
      sku: 'REVOKED',
      name: 'Must not exist',
      quantity: '1',
    }).toString();
    const response = await new Promise((resolve, reject) => {
      const client = httpRequest(
        base + '/products/save',
        {
          method: 'POST',
          headers: { cookie: account.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        },
        (incoming) => {
          incoming.resume();
          incoming.on('end', () => resolve(incoming));
        },
      );
      client.on('error', reject);
      // Wait for the first body chunk to arrive before revoking the session.
      server.once('request', (incoming) =>
        incoming.once('data', () => {
          db.prepare('DELETE FROM sessions WHERE token=?').run(account.token);
          client.end(body.slice(1));
        }),
      );
      client.write(body.slice(0, 1));
    });
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, '/login');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE sku='REVOKED'").get().n, 0);
  },
);

test('Expired sessions cannot modify inventory', async () => {
  const account = session();
  db.prepare('UPDATE sessions SET expires=? WHERE token=?').run(Date.now() - 1, account.token);
  const result = await request('/products/save', account, {
    sku: 'EXPIRED',
    name: 'Must not exist',
    quantity: '1',
  });
  assert.equal(result.headers.get('location'), '/login');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE sku='EXPIRED'").get().n, 0);
});

test('Successful login replaces the previous browser session', async () => {
  const previous = session();
  const form = await loginForm(previous);
  const result = await request('/login', form, { email: 'admin@stash.lv', password });
  assert.equal(result.status, 303);
  assert.equal(
    db.prepare('SELECT token FROM sessions WHERE token=?').get(previous.token),
    undefined,
  );
  const cookie = result.headers.getSetCookie()[0];
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Max-Age=28800']) {
    assert.ok(cookie.includes(flag));
  }
  assert.equal((await request('/', { cookie: cookie.split(';')[0] })).status, 200);
});

test('Login requires CSRF and damaged stored credentials return 401', async () => {
  assert.equal((await request('/login', null, { email: 'admin@stash.lv', password })).status, 403);
  db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(
    'Damaged',
    'damaged@stash.lv',
    'invalid',
    'worker',
  );
  const form = await loginForm();
  assert.equal(
    (await request('/login', form, { email: 'damaged@stash.lv', password })).status,
    401,
  );
  assert.equal(
    (await request('/login', form, { email: 'missing@stash.lv', password })).status,
    401,
  );
});

test('Login lockout expires and successful login resets failures', async () => {
  const form = await loginForm();
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(
      (await request('/login', form, { email: 'admin@stash.lv', password: 'wrong' })).status,
      401,
    );
  }
  assert.equal((await request('/login', form, { email: 'admin@stash.lv', password })).status, 429);
  db.prepare('UPDATE login_limits SET until_time=?').run(Date.now() - 1);
  assert.equal((await request('/login', form, { email: 'admin@stash.lv', password })).status, 303);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM login_limits').get().n, 0);
});

test('Setup creates three usable accounts and refuses to overwrite them', () => {
  const setupDir = mkdtempSync(join(tmpdir(), 'stash-setup-'));
  const options = { encoding: 'utf8', env: { ...process.env, DATA_DIR: setupDir } };
  try {
    const setup = fileURLToPath(new URL('../setup.js', import.meta.url));
    const first = spawnSync(process.execPath, [setup], options);
    assert.equal(first.status, 0, first.stderr);
    const credentials = first.stdout.split(/\r?\n/).filter((line) => line.includes('@stash.lv'));
    assert.equal(credentials.length, 3);
    const second = spawnSync(process.execPath, [setup], options);
    assert.notEqual(second.status, 0);
    assert.ok(!second.stdout.includes('@stash.lv'));
    const database = new DatabaseSync(join(setupDir, 'stash.sqlite'));
    try {
      assert.equal(database.prepare('SELECT COUNT(*) n FROM users').get().n, 3);
      for (const credential of credentials) {
        const [email, initialPassword] = credential.trim().split(/\s+/);
        assert.equal(
          verify(
            initialPassword,
            database.prepare('SELECT password FROM users WHERE email=?').get(email).password,
          ),
          true,
        );
      }
    } finally {
      database.close();
    }
  } finally {
    rmSync(setupDir, { recursive: true, force: true });
  }
});

test('Each role can render its allowed pages, forms and report exports', async () => {
  const accounts = Object.fromEntries(
    ['admin', 'worker', 'sorter'].map((role) => [role, session(role)]),
  );
  assert.equal(
    (
      await request('/products/save', accounts.worker, {
        sku: 'SMOKE',
        name: 'Pārbaudes prece',
        quantity: '5',
      })
    ).status,
    303,
  );
  const product = db.prepare("SELECT id FROM products WHERE sku='SMOKE'").get();
  assert.equal(
    (
      await request('/orders/create', accounts.worker, {
        customer: 'Testa nodaļa',
        [`qty_${product.id}`]: '2',
      })
    ).status,
    303,
  );
  const pages = {
    admin: [
      '/products',
      '/products/new',
      `/products/edit?id=${product.id}`,
      '/users',
      '/users/new',
      '/users/edit?id=1',
      '/placement',
      '/reports',
      '/reports?type=orders',
      '/reports?type=history',
    ],
    worker: [
      '/products',
      '/products/new',
      '/orders',
      '/reports',
      '/reports?type=orders',
      '/reports?type=history',
    ],
    sorter: ['/products', '/placement', '/placement/data', '/reports', '/reports?type=history'],
  };
  for (const [role, paths] of Object.entries(pages)) {
    for (const path of paths) {
      const response = await request(path, accounts[role]);
      assert.equal(response.status, 200, `${role}: ${path}`);
      assert.ok(response.html.includes('<html lang="lv">'));
      assert.ok(response.html.includes(accounts[role].csrf));
    }
    for (const type of role === 'sorter'
      ? ['inventory', 'history']
      : ['inventory', 'orders', 'history']) {
      const response = await request(`/reports.csv?type=${type}`, accounts[role]);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').includes('text/csv'));
    }
  }
  const orders = await request('/orders', accounts.worker);
  assert.ok(orders.html.includes('SMOKE × 2'));
});
