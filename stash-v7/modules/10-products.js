import {
  db,
  allow,
  field,
  integer,
  esc,
  form,
  input,
  table,
  log,
  assert,
  transaction,
} from '../core.js';

export async function route(ctx) {
  const { url, req, data, user } = ctx;
  if (url.pathname !== '/products' && !url.pathname.startsWith('/products/')) {
    return false;
  }
  const canEdit = ['admin', 'worker'].includes(user.role);
  if (req.method === 'POST') {
    allow(ctx, ['admin', 'worker']);
    const id = integer(data.get('id') || '0');
    if (url.pathname === '/products/delete') {
      allow(ctx, ['admin']);
      transaction(() => {
        assert(db.prepare('SELECT id FROM products WHERE id=?').get(id), 'Prece nav atrasta.', 404);
        db.prepare('DELETE FROM products WHERE id=?').run(id);
        log(user, `Dzēsta prece #${id}`);
      });
      ctx.redirect('/products');
      return true;
    }
    if (url.pathname !== '/products/save') {
      return false;
    }
    const sku = field(data, 'sku', 2, 40);
    const name = field(data, 'name', 2, 120);
    const quantity = integer(data.get('quantity'));
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
  if (url.pathname === '/products/new' || url.pathname === '/products/edit') {
    allow(ctx, ['admin', 'worker']);
    const product = url.pathname.endsWith('/edit')
      ? db.prepare('SELECT * FROM products WHERE id=?').get(integer(url.searchParams.get('id'), 1))
      : {};
    assert(product, 'Prece nav atrasta.', 404);
    ctx.send(
      product.id ? 'Rediģēt preci' : 'Pievienot produktu',
      form(
        ctx,
        '/products/save',
        /* HTML */ `
          <input type="hidden" name="id" value="${product.id || 0}" />
          ${input(
            'Preces kods',
            'sku',
            product.sku,
            'text',
            'required minlength="2" maxlength="40" pattern="[A-Za-z0-9_-]+"',
          )}${input(
            'Nosaukums',
            'name',
            product.name,
            'text',
            'required minlength="2" maxlength="120"',
          )}${input(
            'Daudzums (gab.)',
            'quantity',
            product.quantity ?? 0,
            'number',
            'required min="0" max="1000000" step="1"',
          )}
          <p>
            Daudzuma labojums maina pieejamo atlikumu. Pasūtījumiem rezervētās preces uzskaita
            atsevišķi.
          </p>
        `,
      ),
    );
    return true;
  }
  if (url.pathname !== '/products') {
    return false;
  }
  const q = String(url.searchParams.get('q') || '').slice(0, 120);
  const rows = db
    .prepare('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name')
    .all('%' + q + '%', '%' + q + '%');
  ctx.send(
    'Preces',
    /* HTML */ `
      <div class="actions">
        ${canEdit
          ? '<a class="button" href="/products/new"><span class="button-symbol" aria-hidden="true">+</span> Pievienot produktu</a>'
          : ''}
      </div>
      <form method="get" action="/products">
        ${input('Meklēt pēc nosaukuma vai koda', 'q', q, 'search', 'maxlength="120"')}
        <button>Meklēt</button>
      </form>
      ${table(
        ['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis', 'Darbības'],
        rows.map((p) => [
          esc(p.sku),
          esc(p.name),
          p.quantity,
          esc(p.location) || 'Nav izvietota',
          esc(p.condition),
          canEdit
            ? /* HTML */ `
                <a href="/products/edit?id=${p.id}">Rediģēt</a>
                ${user.role === 'admin'
                  ? form(
                      ctx,
                      '/products/delete',
                      /* HTML */ `
                        <input type="hidden" name="id" value="${p.id}" />
                        <label>
                          <input type="checkbox" required />
                          Apstiprinu dzēšanu
                        </label>
                      `,
                      'Dzēst',
                    )
                  : ''}
              `
            : '—',
        ]),
      )}
    `,
  );
  return true;
}
