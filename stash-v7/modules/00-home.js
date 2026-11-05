import { db, esc } from '../core.js';

export function route(ctx) {
  if (ctx.url.pathname !== '/' || ctx.req.method !== 'GET') {
    return false;
  }
  const stats = [
    ['Preču veidi', db.prepare('SELECT COUNT(*) n FROM products').get().n],
    ['Pieejamās vienības', db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM products').get().n],
  ];
  if (ctx.user.role !== 'sorter') {
    stats.push([
      'Aktīvi pasūtījumi',
      db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('Jauns','Apstrādē')").get().n,
    ]);
  }
  ctx.send(
    'Sākums',
    /* HTML */ `
      <p>Sveicināti, ${esc(ctx.user.name)}!</p>
      <div class="stats">
        ${stats
          .map(
            ([label, count]) => /* HTML */ `
              <section>
                <span>${label}</span>
                <strong>${count}</strong>
              </section>
            `,
          )
          .join('')}
      </div>
      <div class="actions">
        <a class="button" href="/products">Apskatīt preces</a>
        ${['admin', 'worker'].includes(ctx.user.role)
          ? '<a class="button secondary" href="/products/new">Pievienot preci</a>'
          : '<a class="button secondary" href="/placement">Mainīt izvietojumu</a>'}
      </div>
    `,
  );
  return true;
}
