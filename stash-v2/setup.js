import { randomBytes } from 'node:crypto';
import { db, hash, assert, transaction } from './core.js';

const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
assert(userCount === 0, 'Konti jau izveidoti. Esošie dati netiek pārrakstīti.');

const initialUsers = [
  ['Administrators', 'admin@stash.lv', 'admin'],
  ['Noliktavas darbinieks', 'worker@stash.lv', 'worker'],
  ['Plauktu kārtotājs', 'sorter@stash.lv', 'sorter'],
];

transaction(() => {
  for (const [name, email, role] of initialUsers) {
    const password = randomBytes(12).toString('base64url') + '!9aA';
    db.prepare(`
      INSERT INTO users(name, email, password, role)
      VALUES (?, ?, ?, ?)
    `).run(name, email, hash(password), role);

    console.log(`${email}  ${password}`);
  }
});

console.log('Saglabājiet paroles drošā vietā. Tās atkārtoti netiks parādītas.');
