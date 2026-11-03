import { db, allow, esc, table, links, assert } from '../core.js';

links.push(['/reports', '▤', 'Sagatavot atskaiti', ['admin', 'worker', 'sorter']]);
function datasets(role) {
  const inventory = {
    title: 'Preču izvietojums un stāvoklis',
    headers: ['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis'],
    rows: db
      .prepare('SELECT sku,name,quantity,location,condition FROM products ORDER BY location,name')
      .all()
      .map((product) => [
        product.sku,
        product.name,
        product.quantity,
        product.location,
        product.condition,
      ]),
  };
  const result = { inventory };
  if (role !== 'sorter') {
    result.orders = {
      title: 'Pasūtījumi',
      headers: ['Nr.', 'Saņēmējs', 'Statuss', 'Izveidots (UTC)', 'Izveidoja', 'Vienības'],
      rows: db
        .prepare(
          'SELECT o.id,o.customer,o.status,o.created,u.name,COALESCE(SUM(i.quantity),0) units FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id ORDER BY o.id DESC',
        )
        .all()
        .map((order) => [
          order.id,
          order.customer,
          order.status,
          order.created,
          order.name || 'Dzēsts lietotājs',
          order.units,
        ]),
    };
  }
  const audit =
    role === 'sorter'
      ? db
          .prepare(
            "SELECT a.created,u.name,a.action FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.action LIKE 'Izvietojums %' ORDER BY a.id DESC",
          )
          .all()
      : db
          .prepare(
            'SELECT a.created,u.name,a.action FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC',
          )
          .all();
  result.history = {
    title: role === 'sorter' ? 'Izvietojuma izmaiņas' : 'Darbību vēsture',
    headers: ['Laiks (UTC)', 'Lietotājs', 'Darbība'],
    rows: audit.map((entry) => [entry.created, entry.name || 'Dzēsts lietotājs', entry.action]),
  };
  return result;
}
export async function route(ctx) {
  if (!['/reports', '/reports.csv'].includes(ctx.url.pathname)) {
    return false;
  }
  allow(ctx, ['admin', 'worker', 'sorter']);
  assert(ctx.req.method === 'GET', 'Metode nav atļauta.', 405);
  const data = datasets(ctx.user.role);
  const type = ctx.url.searchParams.get('type') || 'inventory';
  assert(Object.hasOwn(data, type), 'Atskaite nav atrasta.', 404);
  const selected = data[type];
  if (ctx.url.pathname === '/reports.csv') {
    const cell = (value) => {
      let text = String(value ?? '');
      if (/^[\s]*[=+\-@]/.test(text)) {
        text = "'" + text;
      }
      return '"' + text.replaceAll('"', '""') + '"';
    };
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stash-${type}.csv"`,
    });
    ctx.res.end(
      '\uFEFF' +
        [selected.headers, ...selected.rows].map((row) => row.map(cell).join(';')).join('\r\n'),
    );
    return true;
  }
  ctx.send(
    'Sagatavot atskaiti',
    `<div class="actions">${Object.entries(data)
      .map(([key, item]) => `<a href="/reports?type=${key}">${item.title}</a>`)
      .join(
        '',
      )}</div><section><h2>${selected.title}</h2><p>Ieraksti: ${selected.rows.length}. Sagatavots: ${esc(new Date().toLocaleString('lv-LV', { timeZone: 'Europe/Riga' }))} (Rīga).</p><a class="button" href="/reports.csv?type=${type}">Lejupielādēt CSV</a></section>${table(
      selected.headers,
      selected.rows.map((row) => row.map(esc)),
    )}`,
  );
  return true;
}
