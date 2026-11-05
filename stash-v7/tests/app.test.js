import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'stash-test-'));
process.env.DATA_DIR = temp;
const { db, hash } = await import('../core.js');
const { server } = await import('../server.js');
for (const role of ['admin', 'worker', 'sorter']) {
  db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(
    role,
    role + '@stash.lv',
    hash('TestPassword123!'),
    role,
  );
}
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
async function request(path, session, data) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
  }
  const options = { redirect: 'manual', headers };
  if (data) {
    options.method = 'POST';
    headers['content-type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams({ csrf: session?.csrf || '', ...data });
  }
  const response = await fetch(base + path, options);
  return {
    status: response.status,
    headers: response.headers,
    html: await response.text(),
  };
}
async function login(role) {
  const page = await request('/login');
  const csrf = page.html.match(/name="csrf" value="([^"]+)"/)[1];
  const response = await request(
    '/login',
    { cookie: page.headers.getSetCookie()[0].split(';')[0], csrf },
    { email: role + '@stash.lv', password: 'TestPassword123!' },
  );
  assert.equal(response.status, 303);
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  const home = await request('/', { cookie });
  return { cookie, csrf: home.html.match(/name="csrf" value="([^"]+)"/)[1] };
}
test('Lomas, validācija, pasūtījumu transakcijas un eksports', async (t) => {
  let admin;
  let worker;
  let sorter;
  let product;
  let order;
  await t.test('Anonīms lietotājs tiek novirzīts uz pieslēgšanos', async () =>
    assert.equal((await request('/users')).headers.get('location'), '/login'),
  );
  await t.test('Pieslēgšanās visām trim lomām', async () => {
    admin = await login('admin');
    worker = await login('worker');
    sorter = await login('sorter');
  });
  await t.test('Darbinieks un kārtotājs nevar atvērt lietotājus vai izveidot kontu', async () => {
    for (const s of [worker, sorter]) {
      assert.equal((await request('/users', s)).status, 403);
      assert.equal(
        (
          await request('/users/save', s, {
            name: 'Hacker',
            email: 'h@x.lv',
            password: 'TestPassword123!',
            role: 'admin',
          })
        ).status,
        403,
      );
    }
  });
  await t.test('CSRF tiek pārbaudīts serverī', async () =>
    assert.equal(
      (
        await request('/products/save', admin, {
          csrf: 'wrong',
          sku: 'A1',
          name: 'Test',
          quantity: '5',
        })
      ).status,
      403,
    ),
  );
  await t.test('Serveris noraida negatīvu un daļskaitļa daudzumu', async () => {
    for (const quantity of ['-1', '1.5', 'NaN']) {
      assert.equal(
        (
          await request('/products/save', admin, {
            sku: 'A1',
            name: 'Test',
            quantity,
          })
        ).status,
        400,
      );
    }
  });
  await t.test('Administrators izveido preci, unikāls kods ir obligāts', async () => {
    assert.equal(
      (
        await request('/products/save', admin, {
          sku: 'A1',
          name: 'Skrūves',
          quantity: '10',
        })
      ).status,
      303,
    );
    product = db.prepare("SELECT id FROM products WHERE sku='A1'").get().id;
    assert.equal(
      (
        await request('/products/save', admin, {
          sku: 'A1',
          name: 'Atkārtots',
          quantity: '1',
        })
      ).status,
      409,
    );
  });
  await t.test('Darbinieks rediģē preci; kārtotājam un dzēšanai nav tiesību', async () => {
    assert.equal(
      (
        await request('/products/save', worker, {
          id: product,
          sku: 'A1',
          name: 'Skrūves M8',
          quantity: '10',
        })
      ).status,
      303,
    );
    assert.equal(
      (
        await request('/products/save', sorter, {
          id: product,
          sku: 'A1',
          name: 'Test',
          quantity: '1',
        })
      ).status,
      403,
    );
    assert.equal((await request('/products/delete', worker, { id: product })).status, 403);
  });
  await t.test('Lietotāja ievade tiek HTML ekranēta', async () => {
    await request('/products/save', worker, {
      id: product,
      sku: 'A1',
      name: '<script>alert(1)</script>',
      quantity: '10',
    });
    const r = await request('/products', worker);
    assert.ok(r.html.includes('&lt;script&gt;'));
    assert.ok(!r.html.includes('<script>'));
  });
  await t.test('Kārtotājs atjaunina atrašanās vietu un stāvokli', async () => {
    assert.equal(
      (
        await request('/placement/save', sorter, {
          id: product,
          location: 'A-01-02',
          condition: 'Jāpārbauda',
        })
      ).status,
      303,
    );
    assert.equal(
      db.prepare('SELECT location FROM products WHERE id=?').get(product).location,
      'A-01-02',
    );
    assert.equal(
      (
        await request('/placement/save', worker, {
          id: product,
          location: 'B-1',
          condition: 'Labs',
        })
      ).status,
      403,
    );
  });
  await t.test('Nederīgs stāvoklis tiek noraidīts', async () =>
    assert.equal(
      (
        await request('/placement/save', sorter, {
          id: product,
          location: 'A-1',
          condition: 'Nezināms',
        })
      ).status,
      400,
    ),
  );
  await t.test('Pasūtījums rezervē krājumu', async () => {
    assert.equal(
      (
        await request('/orders/create', worker, {
          customer: 'Ražošana',
          [`qty_${product}`]: '7',
        })
      ).status,
      303,
    );
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product).quantity, 3);
    order = db.prepare('SELECT MAX(id) id FROM orders').get().id;
  });
  await t.test('Nepietiekams atlikums neatstāj daļēju pasūtījumu', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
    assert.equal(
      (
        await request('/orders/create', worker, {
          customer: 'Ražošana',
          [`qty_${product}`]: '4',
        })
      ).status,
      400,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, before);
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product).quantity, 3);
  });
  await t.test('Nevar izlaist statusa posmu', async () =>
    assert.equal(
      (
        await request('/orders/status', worker, {
          id: order,
          status: 'Izpildīts',
        })
      ).status,
      400,
    ),
  );
  await t.test('Apstrāde, atcelšana un atkārtotas atcelšanas aizliegums', async () => {
    assert.equal(
      (
        await request('/orders/status', worker, {
          id: order,
          status: 'Apstrādē',
        })
      ).status,
      303,
    );
    assert.equal(
      (
        await request('/orders/status', worker, {
          id: order,
          status: 'Atcelts',
        })
      ).status,
      303,
    );
    assert.equal(
      (
        await request('/orders/status', worker, {
          id: order,
          status: 'Atcelts',
        })
      ).status,
      400,
    );
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product).quantity, 10);
  });
  await t.test('Vairāku preču pasūtījuma kļūda atritina visus atlikumus', async () => {
    assert.equal(
      (
        await request('/orders/create', worker, {
          customer: 'Ražošana',
          [`qty_${product}`]: '2',
          qty_999999: '1',
        })
      ).status,
      400,
    );
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product).quantity, 10);
  });
  await t.test('Divi vienlaicīgi pieprasījumi nevar pārdot vairāk par atlikumu', async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        request('/orders/create', worker, {
          customer: 'Konkurence',
          [`qty_${product}`]: '7',
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [303, 400]);
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product).quantity, 3);
  });
  await t.test('Pasūtījuma pabeigšana saglabā rezervēto krājumu', async () => {
    const id = db.prepare('SELECT MAX(id) id FROM orders').get().id;
    await request('/orders/status', worker, { id, status: 'Apstrādē' });
    assert.equal(
      (await request('/orders/status', worker, { id, status: 'Izpildīts' })).status,
      303,
    );
    assert.equal(db.prepare('SELECT quantity FROM products WHERE id=?').get(product).quantity, 3);
  });
  await t.test('Saistītu preci nevar dzēst; darījumi saglabājas', async () =>
    assert.equal((await request('/products/delete', admin, { id: product })).status, 409),
  );
  await t.test('Lomu pārbaude darbojas arī eksporta adresē', async () => {
    assert.equal((await request('/reports.csv?type=orders', sorter)).status, 404);
    assert.equal((await request('/reports.csv?type=orders', worker)).status, 200);
    assert.equal((await request('/orders', sorter)).status, 403);
  });
  await t.test('CSV eksports neļauj izpildīt formulas', async () => {
    await request('/products/save', worker, {
      id: product,
      sku: 'A1',
      name: '=1+1',
      quantity: '3',
    });
    assert.ok((await request('/reports.csv', worker)).html.includes("'=1+1"));
  });
  await t.test('Administrators izveido, maina lomu un dzēš kontu', async () => {
    assert.equal(
      (
        await request('/users/save', admin, {
          name: 'Test User',
          email: 'new@stash.lv',
          role: 'worker',
          password: 'StrongPassword123',
        })
      ).status,
      303,
    );
    const id = db.prepare("SELECT id FROM users WHERE email='new@stash.lv'").get().id;
    assert.equal(
      (
        await request('/users/save', admin, {
          id,
          name: 'Test User',
          email: 'new@stash.lv',
          role: 'sorter',
          password: '',
        })
      ).status,
      303,
    );
    assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id).role, 'sorter');
    assert.equal((await request('/users/delete', admin, { id })).status, 303);
  });
  await t.test('Vāja parole un nederīgs e-pasts tiek noraidīti', async () => {
    assert.equal(
      (
        await request('/users/save', admin, {
          name: 'Test User',
          email: 'new@stash.lv',
          role: 'worker',
          password: 'short',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('/users/save', admin, {
          name: 'Test User',
          email: 'invalid',
          role: 'worker',
          password: 'StrongPassword123',
        })
      ).status,
      400,
    );
  });
  await t.test('Administratora paša kontu nevar dzēst vai pazemināt', async () => {
    const id = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
    assert.equal((await request('/users/delete', admin, { id })).status, 400);
    assert.equal(
      (
        await request('/users/save', admin, {
          id,
          name: 'Admin',
          email: 'admin@stash.lv',
          role: 'worker',
        })
      ).status,
      400,
    );
  });
  await t.test('Lomas maiņa atsauc esošās sesijas', async () => {
    const id = db.prepare("SELECT id FROM users WHERE role='worker'").get().id;
    await request('/users/save', admin, {
      id,
      name: 'Worker',
      email: 'worker@stash.lv',
      role: 'sorter',
    });
    assert.equal((await request('/products', worker)).headers.get('location'), '/login');
  });
  await t.test('Izrakstīšanās anulē sesiju', async () => {
    assert.equal((await request('/logout', sorter, {})).status, 303);
    assert.equal((await request('/', sorter)).headers.get('location'), '/login');
  });
  await t.test('Atkārtoti neveiksmīga pieslēgšanās tiek ierobežota', async () => {
    const p = await request('/login');
    const csrf = p.html.match(/name="csrf" value="([^"]+)"/)[1];
    const s = { cookie: p.headers.getSetCookie()[0].split(';')[0], csrf };
    for (let n = 0; n < 5; n++) {
      assert.equal(
        (
          await request('/login', s, {
            email: 'admin@stash.lv',
            password: 'wrong',
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await request('/login', s, {
          email: 'admin@stash.lv',
          password: 'wrong',
        })
      ).status,
      429,
    );
  });
});
