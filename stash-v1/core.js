import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.DATA_DIR || join(import.meta.dirname, 'data');
mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(join(dir, 'stash.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','worker','sorter')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0), location TEXT NOT NULL DEFAULT '', condition TEXT NOT NULL DEFAULT 'Labs' CHECK(condition IN ('Labs','Bojāts','Jāpārbauda')));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, customer TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Jauns','Apstrādē','Izpildīts','Atcelts')), created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(order_id,product_id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_time INTEGER NOT NULL);`);

export function hash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function verify(password, stored) {
  const [salt, h] = stored.split(':');
  return timingSafeEqual(Buffer.from(h, 'hex'), scryptSync(password, salt, 64));
}

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function assert(ok, message, status = 400) {
  if (!ok) {
    const e = new Error(message);
    e.status = status;
    throw e;
  }
}

export function field(data, key, min = 1, max = 100) {
  const value = String(data.get(key) || '').trim();
  assert(value.length >= min && value.length <= max, `Laukam “${key}” jābūt ${min}–${max} rakstzīmēm.`);
  return value;
}

export function integer(value, min = 0, max = 1000000) {
  assert(/^\d+$/.test(String(value)), 'Ievadiet veselu skaitli.');
  const n = Number(value);
  assert(Number.isSafeInteger(n) && n >= min && n <= max, `Skaitlim jābūt no ${min} līdz ${max}.`);
  return n;
}

export const log = (user, action) => db.prepare('INSERT INTO audit(user_id,action) VALUES (?,?)').run(user.id, action);

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function allow(ctx, roles) {
  assert(ctx.user && roles.includes(ctx.user.role), 'Jums nav tiesību veikt šo darbību.', 403);
}

export function form(ctx, action, body, label = 'Saglabāt') {
  return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${esc(ctx.session.csrf)}">${body}<button>${label}</button></form>`;
}

export function input(label, name, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}

export const roles = { admin: 'Administrators', worker: 'Noliktavas darbinieks', sorter: 'Plauktu kārtotājs' };

export const links = [['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']]];

export function page(ctx, title, body) {
  const user = ctx.user;
  return `<!doctype html><html lang="lv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · STASH</title><link rel="stylesheet" href="/style.css"><body>${user?`<aside><div class="brand">⌂STASH</div><nav>${links.filter(l=>l[3].includes(user.role)).map(l=>`<a ${ctx.url.pathname===l[0]?'aria-current="page"':''} href="${l[0]}"><span>${l[1]}</span>${l[2]}</a>`).join('')}${form(ctx,'/logout','','Iziet →')}</nav><div class="identity">${esc(user.name)}<small>${roles[user.role]}</small></div></aside>`:''}<main class="${user?'':'login'}"><header><p class="eyebrow">UZŅĒMUMA IEKŠĒJĀ LIETOTNE</p><h1>${esc(title)}</h1></header>${body}<footer>STASH · Noliktavas vadības sistēma</footer></main></body></html>`;
}

export const table = (headers, rows) => `<div class="table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Nav ierakstu.</td></tr>`}</tbody></table></div>`;
