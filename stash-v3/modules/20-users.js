import { db, log, transaction } from '../lib/database.js';
import { hash } from '../lib/passwords.js';
import { allow, assert, field, integer, roles } from '../lib/validation.js';
import { esc, form, input, links, table } from '../lib/views.js';

links.push(
  ['/users/new', '+', 'Pievienot lietotāju', ['admin']],
  ['/users', '♙', 'Lietotāji', ['admin']],
);

function findUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert(user, 'Lietotājs nav atrasts.', 404);
  return user;
}

function administratorCount() {
  return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
}

function deleteUser(context, id) {
  assert(id !== context.user.id, 'Savu kontu nevar dzēst.');

  transaction(() => {
    const target = findUser(id);
    assert(
      target.role !== 'admin' || administratorCount() > 1,
      'Pēdējo administratoru nevar dzēst.',
    );
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    log(context.user, `Dzēsts lietotājs #${id}`);
  });

  context.redirect('/users');
}

function readUserFields(data, id) {
  const name = field(data, 'name', 2, 100);
  const email = field(data, 'email', 5, 160).toLowerCase();
  const role = field(data, 'role', 5, 10);
  const password = String(data.get('password') || '');

  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Nederīgs e-pasts.');
  assert(Object.hasOwn(roles, role), 'Nederīga loma.');

  if (!id || password) {
    const validPassword = password.length >= 12
      && password.length <= 128
      && /[a-z]/.test(password)
      && /[A-Z]/.test(password)
      && /\d/.test(password);

    assert(
      validPassword,
      'Parolei jābūt 12–128 rakstzīmēm ar lielo burtu, mazo burtu un ciparu.',
    );
  }

  return { name, email, role, password };
}

function saveUser(context, id) {
  const { name, email, role, password } = readUserFields(context.data, id);
  assert(
    id !== context.user.id || role === 'admin',
    'Sava konta administratora tiesības nevar noņemt.',
  );

  transaction(() => {
    if (id) {
      const target = findUser(id);
      assert(
        target.role !== 'admin' || role === 'admin' || administratorCount() > 1,
        'Jāsaglabā vismaz viens administrators.',
      );

      const passwordHash = password ? hash(password) : target.password;
      db.prepare(`
        UPDATE users SET name = ?, email = ?, role = ?, password = ? WHERE id = ?
      `).run(name, email, role, passwordHash, id);

      // Role and password changes must take effect for every active login.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    } else {
      db.prepare(
        'INSERT INTO users(name, email, role, password) VALUES (?, ?, ?, ?)',
      ).run(name, email, role, hash(password));
    }

    log(context.user, `Saglabāts lietotājs ${email}, loma ${role}`);
  });

  context.redirect('/users');
}

function showUserForm(context) {
  const editing = context.url.pathname === '/users/edit';
  const target = editing
    ? findUser(integer(context.url.searchParams.get('id'), 1))
    : {};

  const roleOptions = Object.entries(roles)
    .map(([role, label]) => `
      <option value="${role}" ${role === target.role ? 'selected' : ''}>${label}</option>
    `)
    .join('');

  const passwordLabel = target.id
    ? 'Jauna parole (atstājiet tukšu, lai saglabātu esošo)'
    : 'Parole';
  const passwordAttributes = `${target.id ? '' : 'required'} minlength="12" maxlength="128" autocomplete="new-password"`;

  context.send(target.id ? 'Rediģēt lietotāju' : 'Pievienot lietotāju',
    form(context, '/users/save', `
      <input type="hidden" name="id" value="${target.id || 0}">
      ${input('Vārds, uzvārds', 'name', target.name, 'text',
        'required minlength="2" maxlength="100"')}
      ${input('E-pasts', 'email', target.email, 'email', 'required maxlength="160"')}
      <label>Loma<select name="role">${roleOptions}</select></label>
      ${input(passwordLabel, 'password', '', 'password', passwordAttributes)}
      <p>Vismaz 12 rakstzīmes, lielais un mazais burts un cipars. Pēc konta izmaiņām lietotājam jāpieslēdzas atkārtoti.</p>
    `),
  );
}

function userActions(context, user) {
  const edit = `<a href="/users/edit?id=${user.id}">Rediģēt</a>`;
  if (user.id === context.user.id) return edit;

  return edit + form(context, '/users/delete', `
    <input type="hidden" name="id" value="${user.id}">
    <label><input type="checkbox" required> Apstiprinu dzēšanu</label>
  `, 'Dzēst');
}

function showUsers(context) {
  const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY name').all();
  const rows = users.map(user => [
    esc(user.name),
    esc(user.email),
    roles[user.role],
    userActions(context, user),
  ]);

  context.send('Lietotāji', `
    <a class="button" href="/users/new">+ Pievienot lietotāju</a>
    ${table(['Vārds', 'E-pasts', 'Loma', 'Darbības'], rows)}
  `);
}

export async function route(context) {
  const { url, req, data } = context;
  if (!url.pathname.startsWith('/users')) return false;
  allow(context, ['admin']);

  if (req.method === 'POST') {
    const id = integer(data.get('id') || '0');

    if (url.pathname === '/users/delete') {
      deleteUser(context, id);
      return true;
    }
    if (url.pathname === '/users/save') {
      saveUser(context, id);
      return true;
    }
    return false;
  }

  if (url.pathname === '/users/new' || url.pathname === '/users/edit') {
    showUserForm(context);
    return true;
  }
  if (url.pathname === '/users') {
    showUsers(context);
    return true;
  }
  return false;
}
