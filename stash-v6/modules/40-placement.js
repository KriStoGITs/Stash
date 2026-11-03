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
  ['/placement', '▦', 'Izvietot preces', ['sorter']],
  ['/placement/data', '♙', 'Datu ievade', ['sorter']],
);
export async function route(ctx) {
  const { url, req, data, user } = ctx;
  if (!url.pathname.startsWith('/placement')) {
    return false;
  }
  allow(ctx, ['sorter', 'admin']);
  if (req.method === 'POST') {
    if (url.pathname !== '/placement/save') {
      return false;
    }
    const id = integer(data.get('id'), 1);
    const location = field(data, 'location', 2, 40);
    const condition = field(data, 'condition', 4, 20);
    assert(
      /^[\p{L}\d _./-]+$/u.test(location),
      'Vietas apzīmējumā lietojiet burtus, ciparus, atstarpes vai _ . / -.',
    );
    assert(['Labs', 'Bojāts', 'Jāpārbauda'].includes(condition), 'Nederīgs preces stāvoklis.');
    transaction(() => {
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
      assert(product, 'Prece nav atrasta.', 404);
      db.prepare('UPDATE products SET location=?,condition=? WHERE id=?').run(
        location,
        condition,
        id,
      );
      log(
        user,
        `Izvietojums ${product.sku}: ${product.location || 'nav'} → ${location}; ${product.condition} → ${condition}`,
      );
    });
    ctx.redirect('/placement');
    return true;
  }
  if (!['/placement', '/placement/data'].includes(url.pathname)) {
    return false;
  }
  const products = db.prepare('SELECT * FROM products ORDER BY location,name').all();
  ctx.send(
    url.pathname.endsWith('/data') ? 'Datu ievade' : 'Izvietot preces',
    `<p>Norādiet plaukta apzīmējumu (piemēram, A-01-02) un preces stāvokli.</p>${products.length ? form(ctx, '/placement/save', `<label>Prece<select name="id">${products.map((product) => `<option value="${product.id}">${esc(product.sku)} — ${esc(product.name)} (${esc(product.location) || 'nav vietas'})</option>`).join('')}</select></label>${input('Jaunā atrašanās vieta', 'location', '', 'text', 'required minlength="2" maxlength="40" placeholder="A-01-02"')}<label>Stāvoklis<select name="condition"><option>Labs</option><option>Bojāts</option><option>Jāpārbauda</option></select></label>`, 'Saglabāt izvietojumu') : '<p>Noliktavā vēl nav preču.</p>'}${table(
      ['Kods', 'Prece', 'Daudzums', 'Atrašanās vieta', 'Stāvoklis'],
      products.map((product) => [
        esc(product.sku),
        esc(product.name),
        product.quantity,
        esc(product.location) || 'Nav izvietota',
        esc(product.condition),
      ]),
    )}`,
  );
  return true;
}
