import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDirectory = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');
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
    status TEXT NOT NULL CHECK(status IN ('Jauns', 'Apstrādē', 'Izpildīts', 'Atcelts')),
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

export function log(user, action) {
  db.prepare('INSERT INTO audit(user_id, action) VALUES (?, ?)').run(user.id, action);
}

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
