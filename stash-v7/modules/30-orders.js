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

const transitions = {
  Jauns: ['Apstrādē', 'Atcelts'],
  Apstrādē: ['Izpildīts', 'Atcelts'],
  Izpildīts: [],
  Atcelts: [],
};
export async function route(ctx) {
  const { url, req, data, user } = ctx;
  if (url.pathname !== '/orders' && !url.pathname.startsWith('/orders/')) {
    return false;
  }
  allow(ctx, ['worker']);
  if (req.method === 'POST') {
    if (url.pathname === '/orders/create') {
      const customer = field(data, 'customer', 2, 120);
      const items = [];
      for (const [key, value] of data) {
        if (key.startsWith('qty_')) {
          const quantity = integer(value || '0', 0, 100000);
          if (quantity) {
            items.push({ id: integer(key.slice(4), 1), quantity });
          }
        }
      }
      assert(
        items.length > 0 && items.length <= 100,
        'Izvēlieties 1–100 preces ar daudzumu virs nulles.',
      );
      assert(new Set(items.map((i) => i.id)).size === items.length, 'Preces nedrīkst atkārtoties.');
      transaction(() => {
        const order = db
          .prepare("INSERT INTO orders(user_id,customer,status) VALUES (?,?,'Jauns')")
          .run(user.id, customer);
        for (const item of items) {
          const p = db.prepare('SELECT * FROM products WHERE id=?').get(item.id);
          assert(
            p && p.quantity >= item.quantity,
            `Precei ${p?.name || item.id} nepietiek atlikuma.`,
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
        log(user, `Izveidots pasūtījums #${order.lastInsertRowid}; krājumi rezervēti`);
      });
      ctx.redirect('/orders');
      return true;
    }
    if (url.pathname === '/orders/status') {
      const id = integer(data.get('id'), 1);
      const status = field(data, 'status', 5, 20);
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
        log(user, `Pasūtījums #${id}: ${order.status} → ${status}`);
      });
      ctx.redirect('/orders');
      return true;
    }
    return false;
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
  // Fetch item details once instead of querying separately for every order.
  const itemsByOrder = new Map();
  for (const item of db
    .prepare(
      `
    SELECT i.order_id, p.sku, i.quantity
    FROM order_items i JOIN products p ON p.id = i.product_id
    ORDER BY i.order_id, p.sku
  `,
    )
    .all()) {
    if (!itemsByOrder.has(item.order_id)) {
      itemsByOrder.set(item.order_id, []);
    }
    itemsByOrder.get(item.order_id).push(item);
  }
  ctx.send(
    'Veikt pasūtījumu',
    /* HTML */ `
      <p>
        Izveidojot pasūtījumu, daudzums tiek uzreiz rezervēts. Atcelšana atgriež preces pieejamajā
        atlikumā.
      </p>
      ${products.length
        ? form(
            ctx,
            '/orders/create',
            `${input('Saņēmējs / nodaļa', 'customer', '', 'text', 'required minlength="2" maxlength="120"')}${table(
              ['Kods', 'Prece', 'Pieejams', 'Pasūtīt (gab.)'],
              products.map((p) => [
                esc(p.sku),
                esc(p.name),
                p.quantity,
                /* HTML */ `
                  <input
                    aria-label="${esc(p.name)} daudzums"
                    name="qty_${p.id}"
                    type="number"
                    min="0"
                    max="${Math.min(p.quantity, 100000)}"
                    step="1"
                    value="0"
                  />
                `,
              ]),
            )}`,
            'Izveidot pasūtījumu',
          )
        : '<p>Vispirms pievienojiet preces sadaļā “Preces”.</p>'}
      <h2>Pasūtījumi</h2>
      ${table(
        ['Nr. / datums (UTC)', 'Saņēmējs', 'Izveidoja', 'Preces', 'Statuss', 'Mainīt statusu'],
        orders.map((o) => [
          `${o.id}<br><small>${esc(o.created)}</small>`,
          esc(o.customer),
          esc(o.author || 'Dzēsts lietotājs'),
          (itemsByOrder.get(o.id) || []).map((i) => `${esc(i.sku)} × ${i.quantity}`).join('<br>'),
          esc(o.status),
          transitions[o.status].length
            ? form(
                ctx,
                '/orders/status',
                /* HTML */ `
                  <input type="hidden" name="id" value="${o.id}" />
                  <select name="status" aria-label="Jaunais statuss">
                    ${transitions[o.status]
                      .map(
                        (s) => /* HTML */ `
                          <option>${s}</option>
                        `,
                      )
                      .join('')}
                  </select>
                `,
                'Mainīt',
              )
            : '—',
        ]),
      )}
    `,
  );
  return true;
}
