import { db, log, transaction } from '../lib/database.js';
import { allow, assert, field, integer } from '../lib/validation.js';
import { esc, form, input, links, table } from '../lib/views.js';

const editors = ['admin', 'worker'];

links.push(
  ['/products', '▤', 'Preces', ['admin', 'worker', 'sorter']],
  ['/products/new', '+', 'Pievienot produktu', ['admin']],
);

function findProduct(id) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  assert(product, 'Prece nav atrasta.', 404);
  return product;
}

function deleteProduct(context, id) {
  allow(context, ['admin']);

  transaction(() => {
    findProduct(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    log(context.user, `Dzēsta prece #${id}`);
  });

  context.redirect('/products');
}

function saveProduct(context, id) {
  const { data, user } = context;
  const sku = field(data, 'sku', 2, 40);
  const name = field(data, 'name', 2, 120);
  const quantity = integer(data.get('quantity'));

  assert(/^[A-Za-z0-9_-]+$/.test(sku), 'Preces kodā atļauti burti, cipari, _ un -.');

  transaction(() => {
    if (id) {
      findProduct(id);
      db.prepare(
        'UPDATE products SET sku = ?, name = ?, quantity = ? WHERE id = ?',
      ).run(sku, name, quantity, id);
    } else {
      db.prepare(
        'INSERT INTO products(sku, name, quantity) VALUES (?, ?, ?)',
      ).run(sku, name, quantity);
    }

    log(user, `Saglabāta prece ${sku}, atlikums ${quantity}`);
  });

  context.redirect('/products');
}

function showProductForm(context) {
  allow(context, editors);

  const editing = context.url.pathname === '/products/edit';
  const product = editing
    ? findProduct(integer(context.url.searchParams.get('id'), 1))
    : {};

  const fields = `
    <input type="hidden" name="id" value="${product.id || 0}">
    ${input('Preces kods', 'sku', product.sku, 'text',
      'required minlength="2" maxlength="40" pattern="[A-Za-z0-9_-]+"')}
    ${input('Nosaukums', 'name', product.name, 'text',
      'required minlength="2" maxlength="120"')}
    ${input('Daudzums (gab.)', 'quantity', product.quantity ?? 0, 'number',
      'required min="0" max="1000000" step="1"')}
    <p>Daudzuma labojums maina pieejamo atlikumu. Pasūtījumiem rezervētās preces uzskaita atsevišķi.</p>
  `;

  context.send(
    product.id ? 'Rediģēt preci' : 'Pievienot produktu',
    form(context, '/products/save', fields),
  );
}

function productActions(context, product) {
  if (!editors.includes(context.user.role)) return '—';

  const edit = `<a href="/products/edit?id=${product.id}">Rediģēt</a>`;
  if (context.user.role !== 'admin') return edit;

  const confirmation = `
    <input type="hidden" name="id" value="${product.id}">
    <label><input type="checkbox" required> Apstiprinu dzēšanu</label>
  `;
  return `${edit} ${form(context, '/products/delete', confirmation, 'Dzēst')}`;
}

function showProducts(context) {
  const query = String(context.url.searchParams.get('q') || '').slice(0, 120);
  const searchPattern = `%${query}%`;
  const products = db.prepare(`
    SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name
  `).all(searchPattern, searchPattern);

  const rows = products.map(product => [
    esc(product.sku),
    esc(product.name),
    product.quantity,
    esc(product.location) || 'Nav izvietota',
    esc(product.condition),
    productActions(context, product),
  ]);

  const addProduct = editors.includes(context.user.role)
    ? '<a class="button" href="/products/new">+ Pievienot produktu</a>'
    : '';

  context.send('Preces', `
    <div class="actions">${addProduct}</div>
    <form method="get" action="/products">
      ${input('Meklēt pēc nosaukuma vai koda', 'q', query, 'search', 'maxlength="120"')}
      <button>Meklēt</button>
    </form>
    ${table(['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis', 'Darbības'], rows)}
  `);
}

export async function route(context) {
  const { url, req, data } = context;
  if (!url.pathname.startsWith('/products')) return false;

  if (req.method === 'POST') {
    allow(context, editors);
    const id = integer(data.get('id') || '0');

    if (url.pathname === '/products/delete') {
      deleteProduct(context, id);
      return true;
    }
    if (url.pathname === '/products/save') {
      saveProduct(context, id);
      return true;
    }
    return false;
  }

  if (url.pathname === '/products/new' || url.pathname === '/products/edit') {
    showProductForm(context);
    return true;
  }
  if (url.pathname === '/products') {
    showProducts(context);
    return true;
  }
  return false;
}
