import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const dataDirectory = mkdtempSync(join(tmpdir(), 'stash-test-'));
process.env.DATA_DIR = dataDirectory;
const appRoot = process.env.STASH_TEST_ROOT
  ? pathToFileURL(`${process.env.STASH_TEST_ROOT}/`)
  : new URL('../', import.meta.url);
const { server } = await import(new URL('server.js', appRoot));
const { db, hash, verify, transaction, integer, esc } = await import(
  new URL('core.js', appRoot)
);
const password = 'TestingPassword123';

await test('warehouse workflows preserve permissions and inventory', async (t) => {
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  for (const role of ['admin', 'worker', 'sorter']) {
    db.prepare(
      'INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)',
    ).run(role, `${role}@example.com`, hash(password), role);
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { session, data, cookie } = {}) {
    const headers = {};
    if (session || cookie) headers.Cookie = cookie || session.cookie;
    const response = await fetch(`${baseUrl}${path}`, {
      method: data ? 'POST' : 'GET',
      headers,
      body: data ? new URLSearchParams(data) : undefined,
      redirect: 'manual',
    });
    return {
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
  }

  async function login(role) {
    const page = await request('/login');
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    const csrf = page.text.match(/name="csrf" value="([^"]+)"/)[1];
    const response = await request('/login', {
      cookie,
      data: { csrf, email: `${role}@example.com`, password },
    });
    assert.equal(response.status, 303);
    const sidCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('sid='))
      .split(';')[0];
    const token = sidCookie.slice(4);
    return {
      cookie: sidCookie,
      csrf: db.prepare('SELECT csrf FROM sessions WHERE token=?').get(token)
        .csrf,
      token,
    };
  }

  const post = (path, session, data) =>
    request(path, { session, data: { csrf: session.csrf, ...data } });
  const productQuantity = (id) =>
    db.prepare('SELECT quantity FROM products WHERE id=?').get(id).quantity;
  let admin, worker, sorter, productId, orderId;

  await t.test('passwords, validation and rollback', () => {
    const stored = hash(password);
    assert.equal(verify(password, stored), true);
    assert.equal(verify('wrong', stored), false);
    assert.equal(integer('42'), 42);
    for (const value of ['1.5', '-1', 'abc', '1000001'])
      assert.throws(() => integer(value));
    assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
    assert.throws(() =>
      transaction(() => {
        db.prepare(
          "INSERT INTO products(sku,name) VALUES ('ROLLBACK','Rollback')",
        ).run();
        throw new Error('rollback');
      }),
    );
    assert.equal(
      db.prepare("SELECT id FROM products WHERE sku='ROLLBACK'").get(),
      undefined,
    );
  });

  await t.test('public pages and login protections', async () => {
    const home = await request('/');
    assert.equal(home.status, 303);
    assert.equal(home.headers.get('location'), '/login');
    const css = await request('/style.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      (
        await request('/login', {
          data: { email: 'admin@example.com', password },
        })
      ).status,
      403,
    );
    const loginPage = await request('/login');
    const cookie = loginPage.headers.getSetCookie()[0].split(';')[0];
    const csrf = loginPage.text.match(/name="csrf" value="([^"]+)"/)[1];
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(
        (
          await request('/login', {
            cookie,
            data: { csrf, email: 'admin@example.com', password: 'wrong' },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await request('/login', {
          cookie,
          data: { csrf, email: 'admin@example.com', password },
        })
      ).status,
      429,
    );
    db.exec('DELETE FROM login_limits');
    admin = await login('admin');
    worker = await login('worker');
    sorter = await login('sorter');
  });

  await t.test('role permissions, dashboard and CSRF', async () => {
    for (const session of [admin, worker, sorter]) {
      assert.equal((await request('/', { session })).status, 200);
      assert.equal((await request('/products', { session })).status, 200);
    }
    assert.equal((await request('/users', { session: worker })).status, 403);
    assert.equal((await request('/orders', { session: admin })).status, 403);
    assert.equal(
      (await request('/products/new', { session: sorter })).status,
      403,
    );
    assert.equal(
      (
        await request('/products/save', {
          session: admin,
          data: { sku: 'TEST' },
        })
      ).status,
      403,
    );
    assert.equal((await request('/missing', { session: admin })).status, 404);
  });

  await t.test('product creation, editing, search and validation', async () => {
    assert.equal(
      (await request('/products/new', { session: admin })).status,
      200,
    );
    assert.equal(
      (
        await post('/products/save', admin, {
          sku: 'TEST-1',
          name: '<script>Product</script>',
          quantity: '10',
        })
      ).status,
      303,
    );
    productId = db
      .prepare("SELECT id FROM products WHERE sku='TEST-1'")
      .get().id;
    const page = await request('/products?q=TEST-1', { session: worker });
    assert.match(page.text, /&lt;script&gt;Product&lt;\/script&gt;/);
    assert.equal(
      (await request(`/products/edit?id=${productId}`, { session: worker }))
        .status,
      200,
    );
    assert.equal(
      (
        await post('/products/save', worker, {
          id: productId,
          sku: 'TEST-1',
          name: 'Updated product',
          quantity: '12',
        })
      ).status,
      303,
    );
    assert.equal(productQuantity(productId), 12);
    assert.equal(
      (
        await post('/products/save', admin, {
          sku: 'bad sku',
          name: 'Invalid',
          quantity: '2',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post('/products/save', admin, {
          sku: 'NEGATIVE',
          name: 'Invalid',
          quantity: '-1',
        })
      ).status,
      400,
    );
    assert.equal(
      (await post('/products/delete', worker, { id: productId })).status,
      403,
    );
  });

  await t.test(
    'orders reserve stock and roll back failed reservations',
    async () => {
      assert.equal((await request('/orders', { session: worker })).status, 200);
      assert.equal(
        (
          await post('/orders/create', worker, {
            customer: 'Warehouse',
            [`qty_${productId}`]: '3',
          })
        ).status,
        303,
      );
      orderId = db.prepare('SELECT id FROM orders').get().id;
      assert.equal(productQuantity(productId), 9);
      assert.equal(
        (
          await post('/orders/create', worker, {
            customer: 'Warehouse',
            [`qty_${productId}`]: '99',
          })
        ).status,
        400,
      );
      assert.equal(productQuantity(productId), 9);
      assert.equal(
        db.prepare('SELECT COUNT(*) count FROM orders').get().count,
        1,
      );
      assert.equal(
        (await post('/orders/create', worker, { customer: 'Warehouse' }))
          .status,
        400,
      );
      // The first reservation must roll back if a later product is missing.
      assert.equal(
        (
          await post('/orders/create', worker, {
            customer: 'Warehouse',
            [`qty_${productId}`]: '1',
            qty_999999: '1',
          })
        ).status,
        400,
      );
      assert.equal(productQuantity(productId), 9);
    },
  );

  await t.test(
    'order transitions return stock only once on cancellation',
    async () => {
      assert.equal(
        (
          await post('/orders/status', worker, {
            id: orderId,
            status: 'Izpildīts',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post('/orders/status', worker, {
            id: orderId,
            status: 'Apstrādē',
          })
        ).status,
        303,
      );
      assert.equal(
        (
          await post('/orders/status', worker, {
            id: orderId,
            status: 'Atcelts',
          })
        ).status,
        303,
      );
      assert.equal(productQuantity(productId), 12);
      assert.equal(
        (
          await post('/orders/status', worker, {
            id: orderId,
            status: 'Atcelts',
          })
        ).status,
        400,
      );
      assert.equal(productQuantity(productId), 12);
      assert.equal((await request('/orders', { session: worker })).status, 200);
    },
  );

  await t.test(
    'user management validates accounts and revokes sessions',
    async () => {
      assert.equal(
        (await request('/users/new', { session: admin })).status,
        200,
      );
      assert.equal(
        (
          await post('/users/save', admin, {
            name: 'New user',
            email: 'new@example.com',
            role: 'worker',
            password: 'short',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post('/users/save', admin, {
            name: 'New user',
            email: 'new@example.com',
            role: 'worker',
            password,
          })
        ).status,
        303,
      );
      const userId = db
        .prepare("SELECT id FROM users WHERE email='new@example.com'")
        .get().id;
      assert.equal(
        (await request(`/users/edit?id=${userId}`, { session: admin })).status,
        200,
      );
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
        'test-session',
        userId,
        'test-csrf',
        Date.now() + 60000,
      );
      assert.equal(
        (
          await post('/users/save', admin, {
            id: userId,
            name: 'Updated user',
            email: 'new@example.com',
            role: 'sorter',
            password: '',
          })
        ).status,
        303,
      );
      assert.equal(
        db.prepare("SELECT * FROM sessions WHERE token='test-session'").get(),
        undefined,
      );
      assert.equal(
        verify(
          password,
          db.prepare('SELECT password FROM users WHERE id=?').get(userId)
            .password,
        ),
        true,
      );
      const adminId = db
        .prepare("SELECT id FROM users WHERE role='admin'")
        .get().id;
      assert.equal(
        (await post('/users/delete', admin, { id: adminId })).status,
        400,
      );
      assert.equal(
        (
          await post('/users/save', admin, {
            id: adminId,
            name: 'Admin',
            email: 'admin@example.com',
            role: 'worker',
            password: '',
          })
        ).status,
        400,
      );
      assert.equal(
        (await post('/users/delete', admin, { id: userId })).status,
        303,
      );
      assert.equal((await request('/users', { session: admin })).status, 200);
    },
  );

  await t.test(
    'unreferenced products can be deleted and logout ends sessions',
    async () => {
      assert.equal(
        (
          await post('/products/save', admin, {
            sku: 'DELETE-ME',
            name: 'Temporary',
            quantity: '0',
          })
        ).status,
        303,
      );
      const id = db
        .prepare("SELECT id FROM products WHERE sku='DELETE-ME'")
        .get().id;
      assert.equal((await post('/products/delete', admin, { id })).status, 303);
      assert.equal(
        db.prepare('SELECT * FROM products WHERE id=?').get(id),
        undefined,
      );
      assert.equal((await post('/logout', worker, {})).status, 303);
      assert.equal(
        (await request('/', { session: worker })).headers.get('location'),
        '/login',
      );
      assert.equal(
        db.prepare('SELECT * FROM sessions WHERE token=?').get(worker.token),
        undefined,
      );
    },
  );
});
