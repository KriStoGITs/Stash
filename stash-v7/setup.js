import { db, hash, assert, transaction } from './core.js';
import { randomBytes } from 'node:crypto';
assert(
  db.prepare('SELECT COUNT(*) n FROM users').get().n === 0,
  'Konti jau izveidoti. Esošie dati netiek pārrakstīti.',
);
const credentials = [];
transaction(() => {
  for (const [name, email, role] of [
    ['Administrators', 'admin@stash.lv', 'admin'],
    ['Noliktavas darbinieks', 'worker@stash.lv', 'worker'],
    ['Plauktu kārtotājs', 'sorter@stash.lv', 'sorter'],
  ]) {
    const password = randomBytes(12).toString('base64url') + '!9aA';
    db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(
      name,
      email,
      hash(password),
      role,
    );
    credentials.push(`${email}  ${password}`);
  }
});
for (const credential of credentials) {
  console.log(credential);
}
db.close();
console.log('Saglabājiet paroles drošā vietā. Tās atkārtoti netiks parādītas.');
