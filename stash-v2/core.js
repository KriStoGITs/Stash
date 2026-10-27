import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDirectory = process.env.DATA_DIR || join(import.meta.dirname, 'data');
mkdirSync(dataDirectory, { recursive: true });

export const db = new DatabaseSync(join(dataDirectory, 'stash.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'worker', 'sorter'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    location TEXT NOT NULL DEFAULT '',
    condition TEXT NOT NULL DEFAULT 'Labs'
      CHECK(condition IN ('Labs', 'Bojāts', 'Jāpārbauda'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    customer TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK(status IN ('Jauns', 'Apstrādē', 'Izpildīts', 'Atcelts')),
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(order_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS login_limits (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL,
    until_time INTEGER NOT NULL
  );
`);

export function hash(password) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${passwordHash}`;
}

export function verify(password, stored) {
  const [salt, passwordHash] = stored.split(':');
  const expectedHash = Buffer.from(passwordHash, 'hex');
  const actualHash = scryptSync(password, salt, 64);
  return timingSafeEqual(expectedHash, actualHash);
}

const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const esc = value => String(value ?? '').replace(
  /[&<>"']/g,
  character => htmlEntities[character],
);

export function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

export function field(data, key, min = 1, max = 100) {
  const value = String(data.get(key) || '').trim();
  assert(
    value.length >= min && value.length <= max,
    `Laukam “${key}” jābūt ${min}–${max} rakstzīmēm.`,
  );
  return value;
}

export function integer(value, min = 0, max = 1000000) {
  assert(/^\d+$/.test(String(value)), 'Ievadiet veselu skaitli.');
  const number = Number(value);
  assert(
    Number.isSafeInteger(number) && number >= min && number <= max,
    `Skaitlim jābūt no ${min} līdz ${max}.`,
  );
  return number;
}

export const log = (user, action) => db.prepare(
  'INSERT INTO audit(user_id, action) VALUES (?, ?)',
).run(user.id, action);

export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function allow(ctx, allowedRoles) {
  assert(
    ctx.user && allowedRoles.includes(ctx.user.role),
    'Jums nav tiesību veikt šo darbību.',
    403,
  );
}

export function form(ctx, action, body, label = 'Saglabāt') {
  return `<form method="post" action="${action}">
    <input type="hidden" name="csrf" value="${esc(ctx.session.csrf)}">
    ${body}
    <button>${label}</button>
  </form>`;
}

export function input(label, name, value = '', type = 'text', extra = '') {
  return `<label>${label}
    <input name="${name}" type="${type}" value="${esc(value)}" ${extra}>
  </label>`;
}

export const roles = {
  admin: 'Administrators',
  worker: 'Noliktavas darbinieks',
  sorter: 'Plauktu kārtotājs',
};

export const links = [
  ['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']],
];

function sidebar(ctx) {
  const { user } = ctx;
  const navigation = links
    .filter(([, , , allowedRoles]) => allowedRoles.includes(user.role))
    .map(([path, icon, label]) => {
      const currentPage = ctx.url.pathname === path ? 'aria-current="page"' : '';
      return `<a ${currentPage} href="${path}"><span>${icon}</span>${label}</a>`;
    })
    .join('');

  return `<aside>
    <div class="brand">⌂STASH</div>
    <nav>${navigation}${form(ctx, '/logout', '', 'Iziet →')}</nav>
    <div class="identity">${esc(user.name)}<small>${roles[user.role]}</small></div>
  </aside>`;
}

export function page(ctx, title, body) {
  return `<!doctype html>
<html lang="lv">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · STASH</title>
  <link rel="stylesheet" href="/style.css">
  <body>
    ${ctx.user ? sidebar(ctx) : ''}
    <main class="${ctx.user ? '' : 'login'}">
      <header>
        <p class="eyebrow">UZŅĒMUMA IEKŠĒJĀ LIETOTNE</p>
        <h1>${esc(title)}</h1>
      </header>
      ${body}
      <footer>STASH · Noliktavas vadības sistēma</footer>
    </main>
  </body>
</html>`;
}

export const table = (headers, rows) => {
  const heading = headers.map(header => `<th>${esc(header)}</th>`).join('');
  const body = rows.length
    ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">Nav ierakstu.</td></tr>`;

  return `<div class="table">
    <table>
      <thead><tr>${heading}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
};
