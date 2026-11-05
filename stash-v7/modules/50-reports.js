import { db, allow, esc, table, assert } from '../core.js';

function reportDefinitions(role) {
  const inventory = {
    title: 'Preču izvietojums un stāvoklis',
    headers: ['Kods', 'Nosaukums', 'Pieejams', 'Vieta', 'Stāvoklis'],
    load: () =>
      db
        .prepare('SELECT sku,name,quantity,location,condition FROM products ORDER BY location,name')
        .all()
        .map((p) => [p.sku, p.name, p.quantity, p.location, p.condition]),
  };
  const result = { inventory };
  if (role !== 'sorter') {
    result.orders = {
      title: 'Pasūtījumi',
      headers: ['Nr.', 'Saņēmējs', 'Statuss', 'Izveidots (UTC)', 'Izveidoja', 'Vienības'],
      load: () =>
        db
          .prepare(
            `
      SELECT o.id,o.customer,o.status,o.created,u.name,COALESCE(SUM(i.quantity),0) units
      FROM orders o
      LEFT JOIN users u ON u.id=o.user_id
      LEFT JOIN order_items i ON i.order_id=o.id
      GROUP BY o.id
      ORDER BY o.id DESC
    `,
          )
          .all()
          .map((o) => [
            o.id,
            o.customer,
            o.status,
            o.created,
            o.name || 'Dzēsts lietotājs',
            o.units,
          ]),
    };
  }
  const loadHistory = () =>
    role === 'sorter'
      ? db
          .prepare(
            `
      SELECT a.created,u.name,a.action
      FROM audit a
      LEFT JOIN users u ON u.id=a.user_id
      WHERE a.action LIKE 'Izvietojums %'
      ORDER BY a.id DESC
    `,
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
    load: () => loadHistory().map((a) => [a.created, a.name || 'Dzēsts lietotājs', a.action]),
  };
  return result;
}
export async function route(ctx) {
  if (!['/reports', '/reports.csv'].includes(ctx.url.pathname)) {
    return false;
  }
  allow(ctx, ['admin', 'worker', 'sorter']);
  assert(ctx.req.method === 'GET', 'Metode nav atļauta.', 405);
  const data = reportDefinitions(ctx.user.role);
  const type = ctx.url.searchParams.get('type') || 'inventory';
  assert(Object.hasOwn(data, type), 'Atskaite nav atrasta.', 404);
  const selected = data[type];
  const rows = selected.load();
  if (ctx.url.pathname === '/reports.csv') {
    const cell = (value) => {
      let str = String(value ?? '');
      if (/^[\s]*[=+\-@]/.test(str)) {
        str = "'" + str;
      }
      return '"' + str.replaceAll('"', '""') + '"';
    };
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stash-${type}.csv"`,
    });
    ctx.res.end(
      '\uFEFF' + [selected.headers, ...rows].map((row) => row.map(cell).join(';')).join('\r\n'),
    );
    return true;
  }
  ctx.send(
    'Sagatavot atskaiti',
    /* HTML */ `
      <div class="actions">
        ${Object.entries(data)
          .map(
            ([key, item]) => /* HTML */ `
              <a href="/reports?type=${key}">${item.title}</a>
            `,
          )
          .join('')}
      </div>
      <section>
        <h2>${selected.title}</h2>
        <p>
          Ieraksti: ${rows.length}. Sagatavots:
          ${esc(new Date().toLocaleString('lv-LV', { timeZone: 'Europe/Riga' }))} (Rīga).
        </p>
        <a class="button" href="/reports.csv?type=${type}">Lejupielādēt CSV</a>
      </section>
      ${table(
        selected.headers,
        rows.map((r) => r.map(esc)),
      )}
    `,
  );
  return true;
}
