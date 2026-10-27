import { randomBytes } from 'node:crypto';
import { db, transaction } from './lib/database.js';
import { hash } from './lib/passwords.js';
import { assert } from './lib/validation.js';

const initialUsers = [
  ['Administrators', 'admin@stash.lv', 'admin'],
  ['Noliktavas darbinieks', 'worker@stash.lv', 'worker'],
  ['Plauktu kārtotājs', 'sorter@stash.lv', 'sorter'],
];

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
assert(userCount === 0, 'Konti jau izveidoti. Esošie dati netiek pārrakstīti.');

const credentials = transaction(() => {
  const createUser = db.prepare(
    'INSERT INTO users(name, email, password, role) VALUES (?, ?, ?, ?)',
  );

  return initialUsers.map(([name, email, role]) => {
    const password = randomBytes(12).toString('base64url') + '!9aA';
    createUser.run(name, email, hash(password), role);
    return { email, password };
  });
});

for (const { email, password } of credentials) {
  console.log(`${email}  ${password}`);
}
console.log('Saglabājiet paroles drošā vietā. Tās atkārtoti netiks parādītas.');
