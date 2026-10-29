import { db, recordAudit, transaction } from '../lib/database.js';
import { hashPassword } from '../lib/passwords.js';
import { readField, parseInteger, assert } from '../lib/validation.js';
import { requireRole } from '../lib/authorization.js';
import { escapeHtml, renderForm, renderInput, renderTable } from '../lib/html.js';
import { roleLabels } from '../lib/navigation.js';

export async function route(ctx) {
  const { url, req, user } = ctx;
  if (!url.pathname.startsWith('/users')) {
    return false;
  }
  requireRole(ctx, ['admin']);
  if (req.method === 'POST') {
    return handleUserPost(ctx);
  }
  if (url.pathname === '/users/new' || url.pathname === '/users/edit') {
    return showUserForm(ctx);
  }
  if (url.pathname !== '/users') {
    return false;
  }
  ctx.send(
    'Lietotāji',
    [
      '<a class="button" href="/users/new">+ Pievienot lietotāju</a>',
      renderTable(
        ['Vārds', 'E-pasts', 'Loma', 'Darbības'],
        db
          .prepare('SELECT id,name,email,role FROM users ORDER BY name')
          .all()
          .map((account) => [
            escapeHtml(account.name),
            escapeHtml(account.email),
            roleLabels[account.role],
            [
              `<a href="/users/edit?id=${account.id}">Rediģēt</a>`,
              account.id !== user.id
                ? renderForm(
                    ctx,
                    '/users/delete',
                    `<input type="hidden" name="id" value="${account.id}"><label><input type="checkbox" required> Apstiprinu dzēšanu</label>`,
                    'Dzēst',
                  )
                : '',
            ].join(''),
          ]),
      ),
    ].join(''),
  );
  return true;
}

function handleUserPost(ctx) {
  const { url, data, user } = ctx;

  const id = parseInteger(data.get('id') || '0');
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
      recordAudit(user, `Dzēsts lietotājs #${id}`);
    });
    ctx.redirect('/users');
    return true;
  }
  if (url.pathname !== '/users/save') {
    return false;
  }
  const name = readField(data, 'name', 2, 100);
  const email = readField(data, 'email', 5, 160).toLowerCase();
  const role = readField(data, 'role', 5, 10);
  const password = String(data.get('password') || '');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Nederīgs e-pasts.');
  assert(Object.hasOwn(roleLabels, role), 'Nederīga loma.');
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
        password ? hashPassword(password) : target.password,
        id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    } else {
      db.prepare('INSERT INTO users(name,email,role,password) VALUES (?,?,?,?)').run(
        name,
        email,
        role,
        hashPassword(password),
      );
    }
    recordAudit(user, `Saglabāts lietotājs ${email}, loma ${role}`);
  });
  ctx.redirect('/users');
  return true;
}

function showUserForm(ctx) {
  const { url } = ctx;

  const target = url.pathname.endsWith('/edit')
    ? db
        .prepare('SELECT id,name,email,role FROM users WHERE id=?')
        .get(parseInteger(url.searchParams.get('id'), 1))
    : {};
  assert(target, 'Lietotājs nav atrasts.', 404);
  ctx.send(
    target.id ? 'Rediģēt lietotāju' : 'Pievienot lietotāju',
    renderForm(
      ctx,
      '/users/save',
      [
        `<input type="hidden" name="id" value="${target.id || 0}">`,
        renderInput(
          'Vārds, uzvārds',
          'name',
          target.name,
          'text',
          'required minlength="2" maxlength="100"',
        ),
        renderInput('E-pasts', 'email', target.email, 'email', 'required maxlength="160"'),
        '<label>Loma<select name="role">',
        Object.entries(roleLabels)
          .map(
            ([key, label]) =>
              `<option value="${key}" ${key === target.role ? 'selected' : ''}>${label}</option>`,
          )
          .join(''),
        '</select></label>',
        renderInput(
          target.id ? 'Jauna parole (atstājiet tukšu, lai saglabātu esošo)' : 'Parole',
          'password',
          '',
          'password',
          `${target.id ? '' : 'required'} minlength="12" maxlength="128" autocomplete="new-password"`,
        ),
        '<p>Vismaz 12 rakstzīmes, lielais un mazais burts un cipars. Pēc konta izmaiņām lietotājam jāpieslēdzas atkārtoti.</p>',
      ].join(''),
    ),
  );
  return true;
}
