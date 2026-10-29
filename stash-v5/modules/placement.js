import { db, recordAudit, transaction } from '../lib/database.js';
import { readField, parseInteger, assert } from '../lib/validation.js';
import { requireRole } from '../lib/authorization.js';
import { escapeHtml, renderForm, renderInput, renderTable } from '../lib/html.js';

export async function route(ctx) {
  const { url, req } = ctx;
  if (!url.pathname.startsWith('/placement')) {
    return false;
  }
  requireRole(ctx, ['sorter', 'admin']);
  if (req.method === 'POST') {
    return handlePlacementPost(ctx);
  }
  if (!['/placement', '/placement/data'].includes(url.pathname)) {
    return false;
  }
  const products = db.prepare('SELECT * FROM products ORDER BY location,name').all();
  ctx.send(
    url.pathname.endsWith('/data') ? 'Datu ievade' : 'Izvietot preces',
    [
      '<p>Norādiet plaukta apzīmējumu (piemēram, A-01-02) un preces stāvokli.</p>',
      products.length
        ? renderForm(
            ctx,
            '/placement/save',
            [
              '<label>Prece<select name="id">',
              products
                .map(
                  (product) =>
                    `<option value="${product.id}">${escapeHtml(product.sku)} — ${escapeHtml(product.name)} (${escapeHtml(product.location) || 'nav vietas'})</option>`,
                )
                .join(''),
              '</select></label>',
              renderInput(
                'Jaunā atrašanās vieta',
                'location',
                '',
                'text',
                'required minlength="2" maxlength="40" placeholder="A-01-02"',
              ),
              '<label>Stāvoklis<select name="condition"><option>Labs</option><option>Bojāts</option><option>Jāpārbauda</option></select></label>',
            ].join(''),
            'Saglabāt izvietojumu',
          )
        : '<p>Noliktavā vēl nav preču.</p>',
      renderTable(
        ['Kods', 'Prece', 'Daudzums', 'Atrašanās vieta', 'Stāvoklis'],
        products.map((product) => [
          escapeHtml(product.sku),
          escapeHtml(product.name),
          product.quantity,
          escapeHtml(product.location) || 'Nav izvietota',
          escapeHtml(product.condition),
        ]),
      ),
    ].join(''),
  );
  return true;
}

function handlePlacementPost(ctx) {
  const { url, data, user } = ctx;

  if (url.pathname !== '/placement/save') {
    return false;
  }
  const id = parseInteger(data.get('id'), 1);
  const location = readField(data, 'location', 2, 40);
  const condition = readField(data, 'condition', 4, 20);
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
    recordAudit(
      user,
      `Izvietojums ${product.sku}: ${product.location || 'nav'} → ${location}; ${product.condition} → ${condition}`,
    );
  });
  ctx.redirect('/placement');
  return true;
}
