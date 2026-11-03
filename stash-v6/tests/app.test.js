import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

const dataDirectory = mkdtempSync(join(tmpdir(), 'stash-test-'));
process.env.DATA_DIR = dataDirectory;
const { db, hash, verify, transaction, integer, esc } = await import('../core.js');
const { server } = await import('../server.js');
const password = 'WarehouseTest123';
const clients = {};
let baseUrl;

function csrfFrom(html) {
  const match = html.match(/name="csrf" value="([^"]+)"/);
  assert.ok(match, 'Page should contain a CSRF token');
  return match[1];
}

async function get(path, client) {
  return fetch(baseUrl + path, {
    redirect: 'manual',
    headers: client ? { Cookie: client.cookie } : {},
  });
}

async function post(path, client, fields = {}) {
  return fetch(baseUrl + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: client.cookie },
    body: new URLSearchParams({ csrf: client.csrf, ...fields }),
  });
}

async function login(role) {
  const page = await get('/login');
  const loginCookie = page.headers.getSetCookie()[0].split(';')[0];
  const response = await post(
    '/login',
    {
      cookie: loginCookie,
      csrf: csrfFrom(await page.text()),
    },
    { email: `${role}@test.local`, password },
  );
  assert.equal(response.status, 303);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('sid='))
    .split(';')[0];
  const home = await get('/', { cookie });
  assert.equal(home.status, 200);
  return { cookie, csrf: csrfFrom(await home.text()) };
}

function addProduct(sku, quantity = 10, name = sku) {
  return Number(
    db.prepare('INSERT INTO products(sku,name,quantity) VALUES (?,?,?)').run(sku, name, quantity)
      .lastInsertRowid,
  );
}

function quantity(id) {
  return db.prepare('SELECT quantity FROM products WHERE id=?').get(id).quantity;
}

before(async () => {
  for (const role of ['admin', 'worker', 'sorter']) {
    db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(
      role,
      `${role}@test.local`,
      hash(password),
      role,
    );
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const role of ['admin', 'worker', 'sorter']) clients[role] = await login(role);
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
  rmSync(dataDirectory, { recursive: true, force: true });
});

test('password hashing, numeric validation, and escaping', () => {
  const stored = hash(password);
  assert.equal(verify(password, stored), true);
  assert.equal(verify('WrongPassword', stored), false);
  assert.equal(integer('42'), 42);
  assert.throws(() => integer('1.5'));
  assert.throws(() => integer('-1'));
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('transactions roll back partial writes', () => {
  assert.throws(
    () =>
      transaction(() => {
        addProduct('ROLLBACK');
        throw new Error('abort');
      }),
    /abort/,
  );
  assert.equal(db.prepare('SELECT id FROM products WHERE sku=?').get('ROLLBACK'), undefined);
});

test('anonymous requests redirect and responses include security headers', async () => {
  const response = await get('/products');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const stylesheet = await get('/style.css');
  assert.equal(stylesheet.status, 200);
  assert.ok((await stylesheet.text()).includes('.brand'));
});

test('role restrictions, missing CSRF, and unsupported requests are rejected', async () => {
  assert.equal((await get('/users', clients.worker)).status, 403);
  assert.equal((await get('/orders', clients.sorter)).status, 403);
  assert.equal((await post('/products/save', clients.sorter)).status, 403);
  assert.equal((await post('/products/save', clients.admin, { csrf: '' })).status, 403);
  assert.equal((await fetch(baseUrl + '/', { method: 'PUT' })).status, 405);
  assert.equal(
    (
      await fetch(baseUrl + '/products/save', {
        method: 'POST',
        headers: { Cookie: clients.admin.cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal((await get('/missing', clients.admin)).status, 404);
});

test('login requires its CSRF cookie and rejects incorrect credentials', async () => {
  assert.equal((await post('/login', { cookie: '', csrf: '' })).status, 403);
  const page = await get('/login');
  const client = {
    cookie: page.headers.getSetCookie()[0].split(';')[0],
    csrf: csrfFrom(await page.text()),
  };
  assert.equal(
    (await post('/login', client, { email: 'admin@test.local', password: 'wrong' })).status,
    401,
  );
});

test('product creation, search, updates, and deletion preserve escaped values', async () => {
  assert.equal(
    (
      await post('/products/save', clients.admin, {
        sku: 'CRUD-1',
        name: '<b>Prece</b>',
        quantity: '12',
      })
    ).status,
    303,
  );
  const product = db.prepare('SELECT * FROM products WHERE sku=?').get('CRUD-1');
  const html = await (await get('/products?q=CRUD-1', clients.worker)).text();
  assert.ok(html.includes('&lt;b&gt;Prece&lt;/b&gt;'));
  assert.equal(
    (
      await post('/products/save', clients.worker, {
        id: product.id,
        sku: 'CRUD-1',
        name: 'Updated',
        quantity: '7',
      })
    ).status,
    303,
  );
  assert.equal(quantity(product.id), 7);
  assert.equal((await post('/products/delete', clients.worker, { id: product.id })).status, 403);
  assert.equal((await post('/products/delete', clients.admin, { id: product.id })).status, 303);
  assert.equal(db.prepare('SELECT id FROM products WHERE id=?').get(product.id), undefined);
});

test('orders reserve stock, roll back insufficient stock, and restore it once on cancellation', async () => {
  const first = addProduct('ORDER-1', 10);
  const second = addProduct('ORDER-2', 1);
  const countBefore = db.prepare('SELECT COUNT(*) count FROM orders').get().count;
  assert.equal(
    (
      await post('/orders/create', clients.worker, {
        customer: 'Warehouse',
        [`qty_${first}`]: 3,
        [`qty_${second}`]: 2,
      })
    ).status,
    400,
  );
  assert.equal(quantity(first), 10);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders').get().count, countBefore);
  assert.equal(
    (await post('/orders/create', clients.worker, { customer: 'Warehouse', [`qty_${first}`]: 3 }))
      .status,
    303,
  );
  assert.equal(quantity(first), 7);
  const order = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  assert.equal(
    (await post('/orders/status', clients.worker, { id: order.id, status: 'Izpildīts' })).status,
    400,
  );
  assert.equal(
    (await post('/orders/status', clients.worker, { id: order.id, status: 'Apstrādē' })).status,
    303,
  );
  assert.equal(
    (await post('/orders/status', clients.worker, { id: order.id, status: 'Atcelts' })).status,
    303,
  );
  assert.equal(quantity(first), 10);
  assert.equal(
    (await post('/orders/status', clients.worker, { id: order.id, status: 'Atcelts' })).status,
    400,
  );
  assert.equal(quantity(first), 10);
});

test('placement updates location, condition, and audit history', async () => {
  const id = addProduct('SHELF-1');
  assert.equal(
    (
      await post('/placement/save', clients.sorter, {
        id,
        location: 'A-01-02',
        condition: 'Jāpārbauda',
      })
    ).status,
    303,
  );
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  assert.equal(product.location, 'A-01-02');
  assert.equal(product.condition, 'Jāpārbauda');
  assert.ok(db.prepare("SELECT action FROM audit WHERE action LIKE 'Izvietojums SHELF-1:%'").get());
});

test('reports escape CSV formulas and restrict sorter datasets', async () => {
  addProduct('CSV-1', 2, '=SUM(1;2)');
  const response = await get('/reports.csv?type=inventory', clients.admin);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-disposition').includes('stash-inventory.csv'));
  assert.ok((await response.text()).includes('"\'=SUM(1;2)"'));
  assert.equal((await get('/reports?type=orders', clients.sorter)).status, 404);
  assert.equal((await get('/reports?type=history', clients.sorter)).status, 200);
});

test('user updates revoke sessions and self deletion is blocked', async () => {
  assert.equal(
    (
      await post('/users/save', clients.admin, {
        name: 'New Worker',
        email: 'new@test.local',
        role: 'worker',
        password,
      })
    ).status,
    303,
  );
  const target = db.prepare('SELECT * FROM users WHERE email=?').get('new@test.local');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    'revoked',
    target.id,
    'csrf',
    Date.now() + 60000,
  );
  assert.equal(
    (
      await post('/users/save', clients.admin, {
        id: target.id,
        name: 'Updated Worker',
        email: 'new@test.local',
        role: 'sorter',
        password: '',
      })
    ).status,
    303,
  );
  assert.equal(db.prepare('SELECT token FROM sessions WHERE token=?').get('revoked'), undefined);
  const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
  assert.equal((await post('/users/delete', clients.admin, { id: admin.id })).status, 400);
  assert.equal((await post('/users/delete', clients.admin, { id: target.id })).status, 303);
});

test('form parsing handles UTF-8 characters split between network chunks', async () => {
  const id = addProduct('UTF8-1');
  const body = Buffer.from(
    `csrf=${clients.sorter.csrf}&id=${id}&location=Plaukts Ā&condition=Labs`,
  );
  const split = body.indexOf(Buffer.from('Ā')) + 1;
  const status = await new Promise((resolve, reject) => {
    const req = request(
      baseUrl + '/placement/save',
      {
        method: 'POST',
        headers: {
          Cookie: clients.sorter.cookie,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => req.end(body.subarray(split)), 10);
  });
  assert.equal(status, 303);
  assert.equal(
    db.prepare('SELECT location FROM products WHERE id=?').get(id).location,
    'Plaukts Ā',
  );
});

test('oversized form bodies are rejected', async () => {
  assert.equal(
    (await post('/products/save', clients.admin, { name: 'x'.repeat(33000) })).status,
    413,
  );
});

test('feature lists and edit forms render for their allowed roles', async () => {
  const product = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get();
  const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
  for (const [path, role] of [
    ['/products/new', 'admin'],
    [`/products/edit?id=${product.id}`, 'worker'],
    ['/users', 'admin'],
    ['/users/new', 'admin'],
    [`/users/edit?id=${admin.id}`, 'admin'],
    ['/orders', 'worker'],
    ['/placement', 'sorter'],
    ['/placement/data', 'sorter'],
    ['/reports?type=orders', 'worker'],
  ]) {
    const response = await get(path, clients[role]);
    assert.equal(response.status, 200, `${role} should be able to open ${path}`);
    assert.ok((await response.text()).includes('<html lang="lv">'));
  }
});

test('logout invalidates the session', async () => {
  const client = await login('worker');
  assert.equal((await post('/logout', client)).status, 303);
  assert.equal((await get('/', client)).headers.get('location'), '/login');
});
