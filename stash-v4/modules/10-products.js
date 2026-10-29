import {
  db,
  allow,
  field,
  integer,
  esc,
  form,
  input,
  table,
  links,
  log,
  assert,
  transaction,
} from '../core.js';
links.push(
  ['/products', '▤', 'Preces', ['admin', 'worker', 'sorter']],
  ['/products/new', '+', 'Pievienot produktu', ['admin']],
);
export async function route(ctx) {
  const { url, req, data, user } = ctx;
  if (!url.pathname.startsWith('/products')) {
    return false;
  }
  const canEdit = ['admin', 'worker'].includes(user.role);
  if (req.method === 'POST') {
    allow(ctx, ['admin', 'worker']);
    const id = integer(data.get('id') || '0');
    if (url.pathname === '/products/delete') {
      return deleteProduct(ctx, id);
    }
    if (url.pathname !== '/products/save') {
      return false;
    }
    return saveProduct(ctx, id);
  }
  if (url.pathname === '/products/new' || url.pathname === '/products/edit') {
    return showProductEditor(ctx);
  }
  if (url.pathname !== '/products') {
    return false;
  }
  return showProducts(ctx, canEdit);
}

function deleteProduct(ctx, id) {
  const { user } = ctx;

  allow(ctx, ['admin']);
  transaction(() => {
    assert(
      db.prepare('SELECT id FROM products WHERE id=?').get(id),
      'Prece nav atrasta.',
      404,
    );
    db.prepare('DELETE FROM products WHERE id=?').run(id);
    log(user, `Dzēsta prece #${id}`);
  });
  ctx.redirect('/products');
  return true;
}

function saveProduct(ctx, id) {
  const { data, user } = ctx;

  const sku = field(data, 'sku', 2, 40);
  const name = field(data, 'name', 2, 120);
  const quantity = integer(data.get('quantity'));
  assert(
    /^[A-Za-z0-9_-]+$/.test(sku),
    'Preces kodā atļauti burti, cipari, _ un -.',
  );
  transaction(() => {
    if (id) {
      assert(
        db.prepare('SELECT id FROM products WHERE id=?').get(id),
        'Prece nav atrasta.',
        404,
      );
      db.prepare('UPDATE products SET sku=?,name=?,quantity=? WHERE id=?').run(
        sku,
        name,
        quantity,
        id,
      );
    } else {
      db.prepare('INSERT INTO products(sku,name,quantity) VALUES (?,?,?)').run(
        sku,
        name,
        quantity,
      );
    }
    log(user, `Saglabāta prece ${sku}, atlikums ${quantity}`);
  });
  ctx.redirect('/products');
  return true;
}

function showProductEditor(ctx) {
  const { url } = ctx;

  allow(ctx, ['admin', 'worker']);
  const product = url.pathname.endsWith('/edit')
    ? db
        .prepare('SELECT * FROM products WHERE id=?')
        .get(integer(url.searchParams.get('id'), 1))
    : {};
  assert(product, 'Prece nav atrasta.', 404);
  ctx.send(
    product.id ? 'Rediģēt preci' : 'Pievienot produktu',
    form(
      ctx,
      '/products/save',
      `<input type="hidden" name="id" value="${product.id || 0}">${input('Preces kods', 'sku', product.sku, 'text', 'required minlength="2" maxlength="40" pattern="[A-Za-z0-9_-]+"')}${input('Nosaukums', 'name', product.name, 'text', 'required minlength="2" maxlength="120"')}${input('Daudzums (gab.)', 'quantity', product.quantity ?? 0, 'number', 'required min="0" max="1000000" step="1"')}<p>Daudzuma labojums maina pieejamo atlikumu. Pasūtījumiem rezervētās preces uzskaita atsevišķi.</p>`,
    ),
  );
  return true;
}

function showProducts(ctx, canEdit) {
  const { url, user } = ctx;

  const searchQuery = String(url.searchParams.get('q') || '').slice(0, 120);
  const products = db
    .prepare(
      'SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name',
    )
    .all('%' + searchQuery + '%', '%' + searchQuery + '%');
  ctx.send(
    'Preces',
    `<div class="actions">${canEdit ? '<a class="button" href="/products/new">+ Pievienot produktu</a>' : ''}</div><form method="get" action="/products">${input('Meklēt pēc nosaukuma vai koda', 'q', searchQuery, 'search', 'maxlength="120"')}<button>Meklēt</button></form>${table(
      ['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis', 'Darbības'],
      products.map((product) => [
        esc(product.sku),
        esc(product.name),
        product.quantity,
        esc(product.location) || 'Nav izvietota',
        esc(product.condition),
        canEdit
          ? `<a href="/products/edit?id=${product.id}">Rediģēt</a> ${user.role === 'admin' ? form(ctx, '/products/delete', `<input type="hidden" name="id" value="${product.id}"><label><input type="checkbox" required> Apstiprinu dzēšanu</label>`, 'Dzēst') : ''}`
          : '—',
      ]),
    )}`,
  );
  return true;
}
