import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDirectory = mkdtempSync(join(tmpdir(), 'stash-test-'));
process.env.DATA_DIR = dataDirectory;
const { db, transaction } = await import('../lib/database.js');
const { hashPassword } = await import('../lib/passwords.js');
const { server } = await import('../server.js');
const password = 'TestPassword123!';
let baseUrl;
const accounts = {};

async function request(path, { session, data, method, headers = {} } = {}) {
  const response = await fetch(baseUrl + path, {
    method: method || (data ? 'POST' : 'GET'),
    redirect: 'manual',
    headers: { ...(session ? { Cookie: session.cookie } : {}), ...headers },
    body: data ? new URLSearchParams(data) : undefined,
  });
  return { status: response.status, headers: response.headers, html: await response.text() };
}

async function login(role) {
  const page = await request('/login');
  const cookie = page.headers.getSetCookie()[0].split(';')[0];
  const csrf = page.html.match(/name="csrf" value="([^"]+)"/)[1];
  const response = await request('/login', {
    headers: { Cookie: cookie },
    data: { csrf, email: `${role}@test.local`, password },
  });
  assert.equal(response.status, 303);
  const sessionCookie = response.headers.getSetCookie().find((value) => value.startsWith('sid='));
  assert.match(sessionCookie, /HttpOnly; SameSite=Strict/);
  const token = sessionCookie.split(';')[0].slice(4);
  return {
    cookie: `sid=${token}`,
    csrf: db.prepare('SELECT csrf FROM sessions WHERE token=?').get(token).csrf,
  };
}

async function post(path, role, data) {
  const session = accounts[role];
  return request(path, { session, data: { csrf: session.csrf, ...data } });
}

function seedProduct(sku, quantity = 10) {
  return Number(
    db
      .prepare('INSERT INTO products(sku,name,quantity) VALUES (?,?,?)')
      .run(sku, `Product ${sku}`, quantity).lastInsertRowid,
  );
}

before(async () => {
  for (const role of ['admin', 'worker', 'sorter']) {
    db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(
      role,
      `${role}@test.local`,
      hashPassword(password),
      role,
    );
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const role of ['admin', 'worker', 'sorter']) accounts[role] = await login(role);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dataDirectory, { recursive: true, force: true });
});

test('login, public assets, redirects, and response headers', async () => {
  const anonymous = await request('/products');
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.get('location'), '/login');
  const stylesheet = await request('/style.css');
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  const home = await request('/', { session: accounts.admin });
  assert.equal(home.status, 200);
  assert.match(home.html, /Sveicināti, admin!/);
  assert.match(home.html, /href="\/users"/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await request('/missing', { session: accounts.admin })).status, 404);
  assert.equal((await request('/', { method: 'PUT' })).status, 405);
});

test('role checks and CSRF validation reject unauthorized changes', async () => {
  assert.equal((await request('/users', { session: accounts.worker })).status, 403);
  assert.equal((await request('/orders', { session: accounts.admin })).status, 403);
  assert.equal((await request('/placement', { session: accounts.worker })).status, 403);
  assert.equal((await request('/products', { session: accounts.sorter })).status, 200);
  assert.equal(
    (await post('/products/save', 'sorter', { sku: 'DENIED', name: 'Denied', quantity: 1 })).status,
    403,
  );
  assert.equal(
    (
      await post('/products/save', 'admin', {
        csrf: 'invalid',
        sku: 'BAD',
        name: 'Bad',
        quantity: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM products WHERE sku IN ('DENIED','BAD')").get().n,
    0,
  );
});

test('product creation, search escaping, editing, validation, and deletion', async () => {
  assert.equal(
    (
      await post('/products/save', 'admin', {
        sku: 'EDIT',
        name: '<script>alert(1)</script>',
        quantity: 12,
      })
    ).status,
    303,
  );
  const product = db.prepare("SELECT * FROM products WHERE sku='EDIT'").get();
  const search = await request('/products?q=EDIT', { session: accounts.worker });
  assert.match(search.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(search.html, /<script>/);
  assert.equal(
    (
      await post('/products/save', 'worker', {
        id: product.id,
        sku: 'EDIT',
        name: 'Updated',
        quantity: 8,
      })
    ).status,
    303,
  );
  assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product.id).quantity, 8);
  assert.equal(
    (await post('/products/save', 'admin', { sku: 'Invalid code', name: 'Invalid', quantity: -1 }))
      .status,
    400,
  );
  assert.equal((await post('/products/delete', 'worker', { id: product.id })).status, 403);
  assert.equal((await post('/products/delete', 'admin', { id: product.id })).status, 303);
  assert.equal(db.prepare('SELECT id FROM products WHERE id=?').get(product.id), undefined);
});

test('orders reserve stock, enforce transitions, and restore cancelled stock once', async () => {
  const id = seedProduct('ORDER');
  assert.equal(
    (await post('/orders/create', 'worker', { customer: 'Customer', [`qty_${id}`]: 3 })).status,
    303,
  );
  const order = db.prepare('SELECT * FROM orders ORDER BY id DESC').get();
  assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(id).quantity, 7);
  assert.equal(
    (await post('/orders/status', 'worker', { id: order.id, status: 'Izpildīts' })).status,
    400,
  );
  assert.equal(
    (await post('/orders/status', 'worker', { id: order.id, status: 'Apstrādē' })).status,
    303,
  );
  assert.equal(
    (await post('/orders/status', 'worker', { id: order.id, status: 'Atcelts' })).status,
    303,
  );
  assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(id).quantity, 10);
  assert.equal(
    (await post('/orders/status', 'worker', { id: order.id, status: 'Atcelts' })).status,
    400,
  );
  const page = await request('/orders', { session: accounts.worker });
  assert.equal(page.status, 200);
  assert.match(page.html, /ORDER × 3/);
});

test('insufficient stock rolls back the entire order and earlier reservations', async () => {
  const available = seedProduct('AVAILABLE', 5);
  const unavailable = seedProduct('EMPTY', 0);
  const count = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const response = await post('/orders/create', 'worker', {
    customer: 'Customer',
    [`qty_${available}`]: 2,
    [`qty_${unavailable}`]: 1,
  });
  assert.equal(response.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, count);
  assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(available).quantity, 5);
});

test('placement updates location and condition with an audit record', async () => {
  const id = seedProduct('PLACE');
  assert.equal(
    (await post('/placement/save', 'sorter', { id, location: 'A-01-02', condition: 'Jāpārbauda' }))
      .status,
    303,
  );
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  assert.equal(product.location, 'A-01-02');
  assert.equal(product.condition, 'Jāpārbauda');
  assert.match(
    db.prepare('SELECT action FROM audit ORDER BY id DESC').get().action,
    /Izvietojums PLACE/,
  );
  assert.equal(
    (await post('/placement/save', 'sorter', { id, location: '<invalid>', condition: 'Labs' }))
      .status,
    400,
  );
  assert.equal((await request('/placement/data', { session: accounts.sorter })).status, 200);
});

test('user changes invalidate sessions and protect the current administrator', async () => {
  assert.equal(
    (
      await post('/users/save', 'admin', {
        name: 'New Worker',
        email: 'new@test.local',
        role: 'worker',
        password,
      })
    ).status,
    303,
  );
  const user = db.prepare("SELECT * FROM users WHERE email='new@test.local'").get();
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    'temporary-session',
    user.id,
    'csrf',
    Date.now() + 10000,
  );
  assert.equal(
    (
      await post('/users/save', 'admin', {
        id: user.id,
        name: 'Updated Worker',
        email: user.email,
        role: 'sorter',
        password: '',
      })
    ).status,
    303,
  );
  assert.equal(db.prepare('SELECT * FROM sessions WHERE user_id=?').get(user.id), undefined);
  assert.equal(
    db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password,
    user.password,
  );
  const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
  assert.equal((await post('/users/delete', 'admin', { id: admin.id })).status, 400);
  assert.equal((await post('/users/delete', 'admin', { id: user.id })).status, 303);
});

test('transaction helper rolls back failed writes', () => {
  assert.throws(
    () =>
      transaction(() => {
        seedProduct('ROLLBACK');
        throw new Error('Abort');
      }),
    /Abort/,
  );
  assert.equal(db.prepare("SELECT id FROM products WHERE sku='ROLLBACK'").get(), undefined);
});

test('logout clears the session and invalidates the cookie', async () => {
  const response = await post('/logout', 'sorter', {});
  assert.equal(response.status, 303);
  assert.match(response.headers.getSetCookie()[0], /Max-Age=0/);
  const next = await request('/products', { session: accounts.sorter });
  assert.equal(next.headers.get('location'), '/login');
});
