import { db } from './database.js';
import { esc } from './views.js';

export function showDashboard(context) {
  const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  const stockCount = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS count FROM products',
  ).get().count;
  const activeOrders = db.prepare(`
    SELECT COUNT(*) AS count FROM orders WHERE status IN ('Jauns', 'Apstrādē')
  `).get().count;

  const stats = [
    ['Preču veidi', productCount],
    ['Vienības noliktavā', stockCount],
    ['Aktīvi pasūtījumi', activeOrders],
  ];

  context.send('Sākums', `
    <p>Sveicināti, ${esc(context.user.name)}!</p>
    <div class="stats">
      ${stats.map(([label, count]) => `
        <section><span>${label}</span><strong>${count}</strong></section>
      `).join('')}
    </div>
    <section>
      <h2>Noliktavas darba vieta</h2>
      <p>Izvēlieties darbību kreisajā izvēlnē. Pieejamās sadaļas atbilst jūsu lomai.</p>
    </section>
  `);
}
