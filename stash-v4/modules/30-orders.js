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
links.push(['/orders', '♧', 'Veikt pasūtījumu', ['worker']]);
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
  allow(ctx, ['worker']);
  if (req.method === 'POST') {
    if (url.pathname === '/orders/create') {
      return createOrder(ctx);
    }
    if (url.pathname === '/orders/status') {
      return changeOrderStatus(ctx);
    }
    return false;
  }
  if (url.pathname !== '/orders') {
    return false;
  }
  return showOrders(ctx);
}

function createOrder(ctx) {
  const { data, user } = ctx;

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
  assert(
    new Set(items.map((item) => item.id)).size === items.length,
    'Preces nedrīkst atkārtoties.',
  );
  transaction(() => {
    const order = db
      .prepare(
        "INSERT INTO orders(user_id,customer,status) VALUES (?,?,'Jauns')",
      )
      .run(user.id, customer);
    for (const item of items) {
      const product = db
        .prepare('SELECT * FROM products WHERE id=?')
        .get(item.id);
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
    log(
      user,
      `Izveidots pasūtījums #${order.lastInsertRowid}; krājumi rezervēti`,
    );
  });
  ctx.redirect('/orders');
  return true;
}

function changeOrderStatus(ctx) {
  const { data, user } = ctx;

  const id = integer(data.get('id'), 1);
  const status = field(data, 'status', 5, 20);
  transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    assert(order, 'Pasūtījums nav atrasts.', 404);
    assert(
      transitions[order.status].includes(status),
      'Šāda statusa pāreja nav atļauta.',
    );
    if (status === 'Atcelts') {
      for (const item of db
        .prepare('SELECT * FROM order_items WHERE order_id=?')
        .all(id)) {
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

function showOrders(ctx) {
  const products = db.prepare('SELECT * FROM products ORDER BY name').all();
  const orders = db
    .prepare(
      'SELECT o.*,u.name as author FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC',
    )
    .all();
  ctx.send(
    'Veikt pasūtījumu',
    `<p>Izveidojot pasūtījumu, daudzums tiek uzreiz rezervēts. Atcelšana atgriež preces pieejamajā atlikumā.</p>${
      products.length
        ? form(
            ctx,
            '/orders/create',
            `${input('Saņēmējs / nodaļa', 'customer', '', 'text', 'required minlength="2" maxlength="120"')}${table(
              ['Kods', 'Prece', 'Pieejams', 'Pasūtīt (gab.)'],
              products.map((product) => [
                esc(product.sku),
                esc(product.name),
                product.quantity,
                `<input aria-label="${esc(product.name)} daudzums" name="qty_${product.id}" type="number" min="0" max="${Math.min(product.quantity, 100000)}" step="1" value="0">`,
              ]),
            )}`,
            'Izveidot pasūtījumu',
          )
        : '<p>Vispirms pievienojiet preces sadaļā “Preces”.</p>'
    }<h2>Pasūtījumi</h2>${table(
      [
        'Nr. / datums (UTC)',
        'Saņēmējs',
        'Izveidoja',
        'Preces',
        'Statuss',
        'Mainīt statusu',
      ],
      orders.map((order) => [
        `${order.id}<br><small>${esc(order.created)}</small>`,
        esc(order.customer),
        esc(order.author || 'Dzēsts lietotājs'),
        db
          .prepare(
            'SELECT p.sku,i.quantity FROM order_items i JOIN products p ON p.id=i.product_id WHERE order_id=?',
          )
          .all(order.id)
          .map((item) => `${esc(item.sku)} × ${item.quantity}`)
          .join('<br>'),
        esc(order.status),
        transitions[order.status].length
          ? form(
              ctx,
              '/orders/status',
              `<input type="hidden" name="id" value="${order.id}"><select name="status" aria-label="Jaunais statuss">${transitions[order.status].map((status) => `<option>${status}</option>`).join('')}</select>`,
              'Mainīt',
            )
          : '—',
      ]),
    )}`,
  );
  return true;
}
