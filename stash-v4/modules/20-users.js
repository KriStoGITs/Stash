import {
  db,
  allow,
  roles,
  field,
  integer,
  esc,
  form,
  input,
  table,
  links,
  log,
  assert,
  hash,
  transaction,
} from '../core.js';
links.push(
  ['/users/new', '+', 'Pievienot lietotāju', ['admin']],
  ['/users', '♙', 'Lietotāji', ['admin']],
);
export async function route(ctx) {
  const { url, req, data } = ctx;
  if (!url.pathname.startsWith('/users')) {
    return false;
  }
  allow(ctx, ['admin']);
  if (req.method === 'POST') {
    const id = integer(data.get('id') || '0');
    if (url.pathname === '/users/delete') {
      return deleteUser(ctx, id);
    }
    if (url.pathname !== '/users/save') {
      return false;
    }
    return saveUser(ctx, id);
  }
  if (url.pathname === '/users/new' || url.pathname === '/users/edit') {
    return showUserEditor(ctx);
  }
  if (url.pathname !== '/users') {
    return false;
  }
  return showUsers(ctx);
}

function deleteUser(ctx, id) {
  const { user } = ctx;

  assert(id !== user.id, 'Savu kontu nevar dzēst.');
  transaction(() => {
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    assert(target, 'Lietotājs nav atrasts.', 404);
    assert(
      target.role !== 'admin' ||
        db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n >
          1,
      'Pēdējo administratoru nevar dzēst.',
    );
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    log(user, `Dzēsts lietotājs #${id}`);
  });
  ctx.redirect('/users');
  return true;
}

function saveUser(ctx, id) {
  const { data, user } = ctx;

  const name = field(data, 'name', 2, 100);
  const email = field(data, 'email', 5, 160).toLowerCase();
  const role = field(data, 'role', 5, 10);
  const password = String(data.get('password') || '');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Nederīgs e-pasts.');
  assert(Object.hasOwn(roles, role), 'Nederīga loma.');
  if (!id || password) {
    assert(
      password.length >= 12 &&
        password.length <= 128 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /\d/.test(password),
      'Parolei jābūt 12–128 rakstzīmēm ar lielo burtu, mazo burtu un ciparu.',
    );
  }
  assert(
    id !== user.id || role === 'admin',
    'Sava konta administratora tiesības nevar noņemt.',
  );
  transaction(() => {
    if (id) {
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      assert(target, 'Lietotājs nav atrasts.', 404);
      assert(
        target.role !== 'admin' ||
          role === 'admin' ||
          db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get()
            .n > 1,
        'Jāsaglabā vismaz viens administrators.',
      );
      db.prepare(
        'UPDATE users SET name=?,email=?,role=?,password=? WHERE id=?',
      ).run(name, email, role, password ? hash(password) : target.password, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    } else {
      db.prepare(
        'INSERT INTO users(name,email,role,password) VALUES (?,?,?,?)',
      ).run(name, email, role, hash(password));
    }
    log(user, `Saglabāts lietotājs ${email}, loma ${role}`);
  });
  ctx.redirect('/users');
  return true;
}

function showUserEditor(ctx) {
  const { url } = ctx;

  const target = url.pathname.endsWith('/edit')
    ? db
        .prepare('SELECT id,name,email,role FROM users WHERE id=?')
        .get(integer(url.searchParams.get('id'), 1))
    : {};
  assert(target, 'Lietotājs nav atrasts.', 404);
  ctx.send(
    target.id ? 'Rediģēt lietotāju' : 'Pievienot lietotāju',
    form(
      ctx,
      '/users/save',
      `<input type="hidden" name="id" value="${target.id || 0}">${input('Vārds, uzvārds', 'name', target.name, 'text', 'required minlength="2" maxlength="100"')}${input('E-pasts', 'email', target.email, 'email', 'required maxlength="160"')}<label>Loma<select name="role">${Object.entries(
        roles,
      )
        .map(
          ([key, label]) =>
            `<option value="${key}" ${key === target.role ? 'selected' : ''}>${label}</option>`,
        )
        .join(
          '',
        )}</select></label>${input(target.id ? 'Jauna parole (atstājiet tukšu, lai saglabātu esošo)' : 'Parole', 'password', '', 'password', `${target.id ? '' : 'required'} minlength="12" maxlength="128" autocomplete="new-password"`)}<p>Vismaz 12 rakstzīmes, lielais un mazais burts un cipars. Pēc konta izmaiņām lietotājam jāpieslēdzas atkārtoti.</p>`,
    ),
  );
  return true;
}

function showUsers(ctx) {
  const { user } = ctx;

  ctx.send(
    'Lietotāji',
    `<a class="button" href="/users/new">+ Pievienot lietotāju</a>${table(
      ['Vārds', 'E-pasts', 'Loma', 'Darbības'],
      db
        .prepare('SELECT id,name,email,role FROM users ORDER BY name')
        .all()
        .map((listedUser) => [
          esc(listedUser.name),
          esc(listedUser.email),
          roles[listedUser.role],
          `<a href="/users/edit?id=${listedUser.id}">Rediģēt</a>${listedUser.id !== user.id ? form(ctx, '/users/delete', `<input type="hidden" name="id" value="${listedUser.id}"><label><input type="checkbox" required> Apstiprinu dzēšanu</label>`, 'Dzēst') : ''}`,
        ]),
    )}`,
  );
  return true;
}
