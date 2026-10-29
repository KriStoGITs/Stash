import { db, recordAudit, transaction } from '../lib/database.js';
import { readField, parseInteger, assert } from '../lib/validation.js';
import { requireRole } from '../lib/authorization.js';
import { escapeHtml, renderForm, renderInput, renderTable } from '../lib/html.js';

export async function route(ctx) {
  const { url, req, user } = ctx;
  if (!url.pathname.startsWith('/products')) {
    return false;
  }
  const canEdit = ['admin', 'worker'].includes(user.role);
  if (req.method === 'POST') {
    return handleProductPost(ctx);
  }
  if (url.pathname === '/products/new' || url.pathname === '/products/edit') {
    return showProductForm(ctx);
  }
  if (url.pathname !== '/products') {
    return false;
  }
  const query = String(url.searchParams.get('q') || '').slice(0, 120);
  const products = db
    .prepare('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name')
    .all('%' + query + '%', '%' + query + '%');
  ctx.send(
    'Preces',
    [
      '<div class="actions">',
      canEdit ? '<a class="button" href="/products/new">+ Pievienot produktu</a>' : '',
      '</div><form method="get" action="/products">',
      renderInput('Meklēt pēc nosaukuma vai koda', 'q', query, 'search', 'maxlength="120"'),
      '<button>Meklēt</button></form>',
      renderTable(
        ['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis', 'Darbības'],
        products.map((product) => [
          escapeHtml(product.sku),
          escapeHtml(product.name),
          product.quantity,
          escapeHtml(product.location) || 'Nav izvietota',
          escapeHtml(product.condition),
          canEdit
            ? [
                `<a href="/products/edit?id=${product.id}">Rediģēt</a> `,
                user.role === 'admin'
                  ? renderForm(
                      ctx,
                      '/products/delete',
                      `<input type="hidden" name="id" value="${product.id}"><label><input type="checkbox" required> Apstiprinu dzēšanu</label>`,
                      'Dzēst',
                    )
                  : '',
              ].join('')
            : '—',
        ]),
      ),
    ].join(''),
  );
  return true;
}

function handleProductPost(ctx) {
  const { url, data, user } = ctx;

  requireRole(ctx, ['admin', 'worker']);
  const id = parseInteger(data.get('id') || '0');
  if (url.pathname === '/products/delete') {
    requireRole(ctx, ['admin']);
    transaction(() => {
      assert(db.prepare('SELECT id FROM products WHERE id=?').get(id), 'Prece nav atrasta.', 404);
      db.prepare('DELETE FROM products WHERE id=?').run(id);
      recordAudit(user, `Dzēsta prece #${id}`);
    });
    ctx.redirect('/products');
    return true;
  }
  if (url.pathname !== '/products/save') {
    return false;
  }
  const sku = readField(data, 'sku', 2, 40);
  const name = readField(data, 'name', 2, 120);
  const quantity = parseInteger(data.get('quantity'));
  assert(/^[A-Za-z0-9_-]+$/.test(sku), 'Preces kodā atļauti burti, cipari, _ un -.');
  transaction(() => {
    if (id) {
      assert(db.prepare('SELECT id FROM products WHERE id=?').get(id), 'Prece nav atrasta.', 404);
      db.prepare('UPDATE products SET sku=?,name=?,quantity=? WHERE id=?').run(
        sku,
        name,
        quantity,
        id,
      );
    } else {
      db.prepare('INSERT INTO products(sku,name,quantity) VALUES (?,?,?)').run(sku, name, quantity);
    }
    recordAudit(user, `Saglabāta prece ${sku}, atlikums ${quantity}`);
  });
  ctx.redirect('/products');
  return true;
}

function showProductForm(ctx) {
  const { url } = ctx;

  requireRole(ctx, ['admin', 'worker']);
  const product = url.pathname.endsWith('/edit')
    ? db
        .prepare('SELECT * FROM products WHERE id=?')
        .get(parseInteger(url.searchParams.get('id'), 1))
    : {};
  assert(product, 'Prece nav atrasta.', 404);
  ctx.send(
    product.id ? 'Rediģēt preci' : 'Pievienot produktu',
    renderForm(
      ctx,
      '/products/save',
      [
        `<input type="hidden" name="id" value="${product.id || 0}">`,
        renderInput(
          'Preces kods',
          'sku',
          product.sku,
          'text',
          'required minlength="2" maxlength="40" pattern="[A-Za-z0-9_-]+"',
        ),
        renderInput(
          'Nosaukums',
          'name',
          product.name,
          'text',
          'required minlength="2" maxlength="120"',
        ),
        renderInput(
          'Daudzums (gab.)',
          'quantity',
          product.quantity ?? 0,
          'number',
          'required min="0" max="1000000" step="1"',
        ),
        '<p>Daudzuma labojums maina pieejamo atlikumu. Pasūtījumiem rezervētās preces uzskaita atsevišķi.</p>',
      ].join(''),
    ),
  );
  return true;
}
