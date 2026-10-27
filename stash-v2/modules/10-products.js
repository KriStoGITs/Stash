import {
  db, allow, field, integer, esc, form, input, table, links, log, assert, transaction,
} from '../core.js';

links.push(
  ['/products', '▤', 'Preces', ['admin', 'worker', 'sorter']],
  ['/products/new', '+', 'Pievienot produktu', ['admin']],
);

function deleteProduct(ctx, id) {
  allow(ctx, ['admin']);
  transaction(() => {
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    assert(product, 'Prece nav atrasta.', 404);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    log(ctx.user, `Dzēsta prece #${id}`);
  });
  ctx.redirect('/products');
}

function saveProduct(ctx, id) {
  const sku = field(ctx.data, 'sku', 2, 40);
  const name = field(ctx.data, 'name', 2, 120);
  const quantity = integer(ctx.data.get('quantity'));
  assert(/^[A-Za-z0-9_-]+$/.test(sku), 'Preces kodā atļauti burti, cipari, _ un -.');

  transaction(() => {
    if (id) {
      const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
      assert(product, 'Prece nav atrasta.', 404);
      db.prepare(`
        UPDATE products SET sku = ?, name = ?, quantity = ? WHERE id = ?
      `).run(sku, name, quantity, id);
    } else {
      db.prepare(`
        INSERT INTO products(sku, name, quantity) VALUES (?, ?, ?)
      `).run(sku, name, quantity);
    }
    log(ctx.user, `Saglabāta prece ${sku}, atlikums ${quantity}`);
  });
  ctx.redirect('/products');
}

function showProductForm(ctx) {
  allow(ctx, ['admin', 'worker']);
  let product = {};
  if (ctx.url.pathname.endsWith('/edit')) {
    const id = integer(ctx.url.searchParams.get('id'), 1);
    product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  }
  assert(product, 'Prece nav atrasta.', 404);

  const fields = `
    <input type="hidden" name="id" value="${product.id || 0}">
    ${input('Preces kods', 'sku', product.sku, 'text', 'required minlength="2" maxlength="40" pattern="[A-Za-z0-9_-]+"')}
    ${input('Nosaukums', 'name', product.name, 'text', 'required minlength="2" maxlength="120"')}
    ${input('Daudzums (gab.)', 'quantity', product.quantity ?? 0, 'number', 'required min="0" max="1000000" step="1"')}
    <p>Daudzuma labojums maina pieejamo atlikumu. Pasūtījumiem rezervētās preces uzskaita atsevišķi.</p>
  `;
  const title = product.id ? 'Rediģēt preci' : 'Pievienot produktu';
  ctx.send(title, form(ctx, '/products/save', fields));
}

function productActions(ctx, product, canEdit) {
  if (!canEdit) return '—';

  let actions = `<a href="/products/edit?id=${product.id}">Rediģēt</a> `;
  if (ctx.user.role === 'admin') {
    actions += form(ctx, '/products/delete', `
      <input type="hidden" name="id" value="${product.id}">
      <label><input type="checkbox" required> Apstiprinu dzēšanu</label>
    `, 'Dzēst');
  }
  return actions;
}

function showProducts(ctx, canEdit) {
  const query = String(ctx.url.searchParams.get('q') || '').slice(0, 120);
  const searchPattern = '%' + query + '%';
  const products = db.prepare(`
    SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name
  `).all(searchPattern, searchPattern);

  const rows = products.map(product => [
    esc(product.sku),
    esc(product.name),
    product.quantity,
    esc(product.location) || 'Nav izvietota',
    esc(product.condition),
    productActions(ctx, product, canEdit),
  ]);

  ctx.send('Preces', `
    <div class="actions">
      ${canEdit ? '<a class="button" href="/products/new">+ Pievienot produktu</a>' : ''}
    </div>
    <form method="get" action="/products">
      ${input('Meklēt pēc nosaukuma vai koda', 'q', query, 'search', 'maxlength="120"')}
      <button>Meklēt</button>
    </form>
    ${table(['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis', 'Darbības'], rows)}
  `);
}

export async function route(ctx) {
  const { url, req, data, user } = ctx;
  if (!url.pathname.startsWith('/products')) return false;

  const canEdit = ['admin', 'worker'].includes(user.role);
  if (req.method === 'POST') {
    allow(ctx, ['admin', 'worker']);
    const id = integer(data.get('id') || '0');

    if (url.pathname === '/products/delete') {
      deleteProduct(ctx, id);
      return true;
    }
    if (url.pathname !== '/products/save') return false;

    saveProduct(ctx, id);
    return true;
  }

  if (url.pathname === '/products/new' || url.pathname === '/products/edit') {
    showProductForm(ctx);
    return true;
  }
  if (url.pathname !== '/products') return false;

  showProducts(ctx, canEdit);
  return true;
}
