'use strict';

// Резервная копия базы (заказы и товары) в файл. Безопасно выполнять при работающем магазине.
//   npm run backup                      -> data/backups/shop-ГГГГ-ММ-ДД-ЧЧММСС.db
//   node scripts/backup.js путь/файл.db -> в указанный файл
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { load } = require('../src/config');

const config = load();
if (!fs.existsSync(config.dbFile)) {
  console.error(`База не найдена: ${config.dbFile}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const target = process.argv[2] || path.join(config.dataDir, 'backups', `shop-${stamp}.db`);
fs.mkdirSync(path.dirname(target), { recursive: true });

const db = new Database(config.dbFile, { readonly: true });
db.backup(target)
  .then(() => console.log(`Копия сохранена: ${target}`))
  .catch((err) => {
    console.error('Не удалось сделать копию:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
