import { db } from '../lib/database.js';
import { escapeHtml } from '../lib/html.js';

export function showDashboard(ctx) {
  const stats = [
    ['Preču veidi', db.prepare('SELECT COUNT(*) n FROM products').get().n],
    ['Vienības noliktavā', db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM products').get().n],
    [
      'Aktīvi pasūtījumi',
      db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('Jauns','Apstrādē')").get().n,
    ],
  ];
  return ctx.send(
    'Sākums',
    `<p>Sveicināti, ${escapeHtml(ctx.user.name)}!</p><div class="stats">${stats.map(([label, value]) => `<section><span>${label}</span><strong>${value}</strong></section>`).join('')}</div><section><h2>Noliktavas darba vieta</h2><p>Izvēlieties darbību kreisajā izvēlnē. Pieejamās sadaļas atbilst jūsu lomai.</p></section>`,
  );
}
