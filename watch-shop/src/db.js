'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  brand       TEXT    NOT NULL,
  gender      TEXT    NOT NULL CHECK (gender IN ('men','women','unisex')),
  movement    TEXT    NOT NULL CHECK (movement IN ('quartz','mechanical','automatic','smart')),
  price       INTEGER NOT NULL CHECK (price >= 0),       -- в минорных единицах
  old_price   INTEGER CHECK (old_price IS NULL OR old_price >= 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  description TEXT    NOT NULL DEFAULT '',
  specs       TEXT    NOT NULL DEFAULT '[]',             -- JSON: [["Ключ","Значение"], ...]
  image       TEXT,                                      -- имя файла в uploads, либо NULL (рисуется заглушка)
  is_active   INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_active ON products (is_active, gender, movement);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id       TEXT    NOT NULL UNIQUE,               -- номер для клиента, например 4F7K2Q
  status          TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','shipped','done','cancelled')),
  customer_name   TEXT    NOT NULL,
  phone           TEXT    NOT NULL,
  email           TEXT    NOT NULL DEFAULT '',
  delivery_method TEXT    NOT NULL CHECK (delivery_method IN ('pickup','courier','post')),
  address         TEXT    NOT NULL DEFAULT '',
  payment_method  TEXT    NOT NULL CHECK (payment_method IN ('cod','transfer')),
  comment         TEXT    NOT NULL DEFAULT '',
  subtotal        INTEGER NOT NULL,
  delivery_cost   INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products (id) ON DELETE SET NULL,
  name       TEXT    NOT NULL,                           -- снимок названия на момент заказа
  price      INTEGER NOT NULL,                           -- снимок цены на момент заказа
  qty        INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // SQLite умеет приводить к нижнему регистру только латиницу, поэтому для кириллицы своя функция
  db.function('lower_u', { deterministic: true }, (s) => String(s ?? '').toLowerCase());
  db.exec(SCHEMA);
  return db;
}

module.exports = { open };
