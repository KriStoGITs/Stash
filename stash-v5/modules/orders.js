import { db, recordAudit, transaction } from '../lib/database.js';
import { readField, parseInteger, assert } from '../lib/validation.js';
import { requireRole } from '../lib/authorization.js';
import { escapeHtml, renderForm, renderInput, renderTable } from '../lib/html.js';

const transitions = {
  Jauns: ['Apstrādē', 'Atcelts'],
  Apstrādē: ['Izpildīts', 'Atcelts'],
  Izpildīts: [],
  Atcelts: [],
};

export async function route(ctx) {
  const { url, req } = ctx;
  if (!url.pathname.startsWith('/orders')) {
    return false;
  }
  requireRole(ctx, ['worker']);
  if (req.method === 'POST') {
    return handleOrderPost(ctx);
  }
  if (url.pathname !== '/orders') {
    return false;
  }
  const products = db.prepare('SELECT * FROM products ORDER BY name').all();
  const orders = db
    .prepare(
      'SELECT o.*,u.name as author FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC',
    )
    .all();
  ctx.send(
    'Veikt pasūtījumu',
    [
      '<p>Izveidojot pasūtījumu, daudzums tiek uzreiz rezervēts. Atcelšana atgriež preces pieejamajā atlikumā.</p>',
      products.length
        ? renderForm(
            ctx,
            '/orders/create',
            `${renderInput('Saņēmējs / nodaļa', 'customer', '', 'text', 'required minlength="2" maxlength="120"')}${renderTable(
              ['Kods', 'Prece', 'Pieejams', 'Pasūtīt (gab.)'],
              products.map((product) => [
                escapeHtml(product.sku),
                escapeHtml(product.name),
                product.quantity,
                `<input aria-label="${escapeHtml(product.name)} daudzums" name="qty_${product.id}" type="number" min="0" max="${Math.min(product.quantity, 100000)}" step="1" value="0">`,
              ]),
            )}`,
            'Izveidot pasūtījumu',
          )
        : '<p>Vispirms pievienojiet preces sadaļā “Preces”.</p>',
      '<h2>Pasūtījumi</h2>',
      renderTable(
        ['Nr. / datums (UTC)', 'Saņēmējs', 'Izveidoja', 'Preces', 'Statuss', 'Mainīt statusu'],
        orders.map((order) => [
          `${order.id}<br><small>${escapeHtml(order.created)}</small>`,
          escapeHtml(order.customer),
          escapeHtml(order.author || 'Dzēsts lietotājs'),
          db
            .prepare(
              'SELECT p.sku,i.quantity FROM order_items i JOIN products p ON p.id=i.product_id WHERE order_id=?',
            )
            .all(order.id)
            .map((item) => `${escapeHtml(item.sku)} × ${item.quantity}`)
            .join('<br>'),
          escapeHtml(order.status),
          transitions[order.status].length
            ? renderForm(
                ctx,
                '/orders/status',
                [
                  `<input type="hidden" name="id" value="${order.id}"><select name="status" aria-label="Jaunais statuss">`,
                  transitions[order.status].map((status) => `<option>${status}</option>`).join(''),
                  '</select>',
                ].join(''),
                'Mainīt',
              )
            : '—',
        ]),
      ),
    ].join(''),
  );
  return true;
}

function handleOrderPost(ctx) {
  const { url, data, user } = ctx;

  if (url.pathname === '/orders/create') {
    const customer = readField(data, 'customer', 2, 120);
    const items = [];
    for (const [key, value] of data) {
      if (key.startsWith('qty_')) {
        const quantity = parseInteger(value || '0', 0, 100000);
        if (quantity) {
          items.push({ id: parseInteger(key.slice(4), 1), quantity });
        }
      }
    }
    assert(
      items.length > 0 && items.length <= 100,
      'Izvēlieties 1–100 preces ar daudzumu virs nulles.',
    );
    assert(
      new Set(items.map((item) => item.id)).size === items.length,
      'Preces nedrīkst atkārtoties.',
    );
    transaction(() => {
      const order = db
        .prepare("INSERT INTO orders(user_id,customer,status) VALUES (?,?,'Jauns')")
        .run(user.id, customer);
      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.id);
        assert(
          product && product.quantity >= item.quantity,
          `Precei ${product?.name || item.id} nepietiek atlikuma.`,
        );
        db.prepare('UPDATE products SET quantity=quantity-? WHERE id=?').run(
          item.quantity,
          item.id,
        );
        db.prepare('INSERT INTO order_items VALUES (?,?,?)').run(
          order.lastInsertRowid,
          item.id,
          item.quantity,
        );
      }
      recordAudit(user, `Izveidots pasūtījums #${order.lastInsertRowid}; krājumi rezervēti`);
    });
    ctx.redirect('/orders');
    return true;
  }
  if (url.pathname === '/orders/status') {
    const id = parseInteger(data.get('id'), 1);
    const status = readField(data, 'status', 5, 20);
    transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      assert(order, 'Pasūtījums nav atrasts.', 404);
      assert(transitions[order.status].includes(status), 'Šāda statusa pāreja nav atļauta.');
      if (status === 'Atcelts') {
        for (const item of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)) {
          db.prepare('UPDATE products SET quantity=quantity+? WHERE id=?').run(
            item.quantity,
            item.product_id,
          );
        }
      }
      db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, id);
      recordAudit(user, `Pasūtījums #${id}: ${order.status} → ${status}`);
    });
    ctx.redirect('/orders');
    return true;
  }
  return false;
}
