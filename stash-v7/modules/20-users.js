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
  log,
  assert,
  hash,
  transaction,
} from '../core.js';

export async function route(ctx) {
  const { url, req, data, user } = ctx;
  if (url.pathname !== '/users' && !url.pathname.startsWith('/users/')) {
    return false;
  }
  allow(ctx, ['admin']);
  if (req.method === 'POST') {
    const id = integer(data.get('id') || '0');
    if (url.pathname === '/users/delete') {
      assert(id !== user.id, 'Savu kontu nevar dzēst.');
      transaction(() => {
        const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        assert(target, 'Lietotājs nav atrasts.', 404);
        assert(
          target.role !== 'admin' ||
            db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n > 1,
          'Pēdējo administratoru nevar dzēst.',
        );
        db.prepare('DELETE FROM users WHERE id=?').run(id);
        log(user, `Dzēsts lietotājs #${id}`);
      });
      ctx.redirect('/users');
      return true;
    }
    if (url.pathname !== '/users/save') {
      return false;
    }
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
    assert(id !== user.id || role === 'admin', 'Sava konta administratora tiesības nevar noņemt.');
    transaction(() => {
      if (id) {
        const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        assert(target, 'Lietotājs nav atrasts.', 404);
        assert(
          target.role !== 'admin' ||
            role === 'admin' ||
            db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n > 1,
          'Jāsaglabā vismaz viens administrators.',
        );
        db.prepare('UPDATE users SET name=?,email=?,role=?,password=? WHERE id=?').run(
          name,
          email,
          role,
          password ? hash(password) : target.password,
          id,
        );
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      } else {
        db.prepare('INSERT INTO users(name,email,role,password) VALUES (?,?,?,?)').run(
          name,
          email,
          role,
          hash(password),
        );
      }
      log(user, `Saglabāts lietotājs ${email}, loma ${role}`);
    });
    ctx.redirect('/users');
    return true;
  }
  if (url.pathname === '/users/new' || url.pathname === '/users/edit') {
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
        /* HTML */ `
          <input type="hidden" name="id" value="${target.id || 0}" />
          ${input(
            'Vārds, uzvārds',
            'name',
            target.name,
            'text',
            'required minlength="2" maxlength="100"',
          )}${input('E-pasts', 'email', target.email, 'email', 'required maxlength="160"')}
          <label>
            Loma
            <select name="role">
              ${Object.entries(roles)
                .map(
                  ([key, label]) => /* HTML */ `
                    <option value="${key}" ${key === target.role ? 'selected' : ''}>
                      ${label}
                    </option>
                  `,
                )
                .join('')}
            </select>
          </label>
          ${input(
            target.id ? 'Jauna parole (atstājiet tukšu, lai saglabātu esošo)' : 'Parole',
            'password',
            '',
            'password',
            `${target.id ? '' : 'required'} minlength="12" maxlength="128" autocomplete="new-password"`,
          )}
          <p>
            Vismaz 12 rakstzīmes, lielais un mazais burts un cipars. Pēc konta izmaiņām lietotājam
            jāpieslēdzas atkārtoti.
          </p>
        `,
      ),
    );
    return true;
  }
  if (url.pathname !== '/users') {
    return false;
  }
  ctx.send(
    'Lietotāji',
    /* HTML */ `
      <a class="button" href="/users/new">
        <span class="button-symbol" aria-hidden="true">+</span>
        Pievienot lietotāju
      </a>
      ${table(
        ['Vārds', 'E-pasts', 'Loma', 'Darbības'],
        db
          .prepare('SELECT id,name,email,role FROM users ORDER BY name')
          .all()
          .map((u) => [
            esc(u.name),
            esc(u.email),
            roles[u.role],
            /* HTML */ `
              <a href="/users/edit?id=${u.id}">Rediģēt</a>
              ${u.id !== user.id
                ? form(
                    ctx,
                    '/users/delete',
                    /* HTML */ `
                      <input type="hidden" name="id" value="${u.id}" />
                      <label>
                        <input type="checkbox" required />
                        Apstiprinu dzēšanu
                      </label>
                    `,
                    'Dzēst',
                  )
                : ''}
            `,
          ]),
      )}
    `,
  );
  return true;
}
